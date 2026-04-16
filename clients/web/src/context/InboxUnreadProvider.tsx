import {
  useCallback,
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
import { InboxUnreadContext } from './inboxUnreadContext'

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
    ws.onopen = () => {
      const token = getAccessToken()
      if (!token) {
        ws.close()
        return
      }
      ws.send(JSON.stringify({ authToken: token }))
    }

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
