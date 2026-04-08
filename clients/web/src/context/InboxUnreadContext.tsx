import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useLocation } from 'react-router-dom'
import { getAccessToken } from '../lib/auth'
import {
  fetchUnreadInboxCount,
  mailboxWebSocketUrl,
  parseMailboxWsMessage,
} from '../lib/communicationApi'

type InboxUnreadValue = {
  unreadInboxCount: number
  /** Incremented on each realtime mailbox event so lists can refetch. */
  mailboxRevision: number
  refreshUnread: () => Promise<void>
}

const InboxUnreadContext = createContext<InboxUnreadValue | null>(null)

export function InboxUnreadProvider({ children }: { children: ReactNode }) {
  const location = useLocation()
  const [unreadInboxCount, setUnreadInboxCount] = useState(0)
  const [mailboxRevision, setMailboxRevision] = useState(0)
  const wsRef = useRef<WebSocket | null>(null)

  const refreshUnread = useCallback(async () => {
    if (!getAccessToken()) {
      setUnreadInboxCount(0)
      return
    }
    try {
      const n = await fetchUnreadInboxCount()
      setUnreadInboxCount(n)
    } catch {
      /* keep previous count */
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!getAccessToken()) {
        setUnreadInboxCount(0)
        return
      }
      try {
        const n = await fetchUnreadInboxCount()
        if (!cancelled) setUnreadInboxCount(n)
      } catch {
        if (!cancelled) setUnreadInboxCount(0)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [location.pathname])

  useEffect(() => {
    const url = mailboxWebSocketUrl()
    if (!url) {
      return
    }

    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onmessage = (ev) => {
      const msg = parseMailboxWsMessage(String(ev.data))
      if (msg?.type === 'mailbox_updated') {
        void refreshUnread()
        setMailboxRevision((r) => r + 1)
      }
    }

    return () => {
      ws.close()
      if (wsRef.current === ws) {
        wsRef.current = null
      }
    }
  }, [location.pathname, refreshUnread])

  const value = useMemo(
    () => ({ unreadInboxCount, mailboxRevision, refreshUnread }),
    [unreadInboxCount, mailboxRevision, refreshUnread],
  )

  return <InboxUnreadContext.Provider value={value}>{children}</InboxUnreadContext.Provider>
}

export function useInboxUnreadCount() {
  return useContext(InboxUnreadContext)?.unreadInboxCount ?? 0
}

export function useMailboxRevision() {
  return useContext(InboxUnreadContext)?.mailboxRevision ?? 0
}

export function useRefreshUnread() {
  return useContext(InboxUnreadContext)?.refreshUnread ?? (async () => {})
}
