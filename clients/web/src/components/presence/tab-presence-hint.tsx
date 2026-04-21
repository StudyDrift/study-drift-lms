import { useEffect, useId, useRef, useState } from 'react'

type PingMessage = { type: 'ping'; tabId: string; ts: number }

/**
 * Shows when the same course is open in another browser tab (same machine, same origin).
 * Complements future server-driven co-presence.
 */
export function TabPresenceHint({ channelKey }: { channelKey: string }) {
  const reactId = useId()
  const tabId = reactId.replace(/:/g, '')
  const [others, setOthers] = useState(0)
  const lastSeenRef = useRef<Map<string, number>>(new Map())

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return
    const ch = new BroadcastChannel(`lextures-course-tabs:${channelKey}`)
    const onMsg = (ev: MessageEvent) => {
      const data = ev.data as PingMessage
      if (!data || data.type !== 'ping' || typeof data.tabId !== 'string') return
      if (data.tabId === tabId) return
      lastSeenRef.current.set(data.tabId, data.ts)
    }
    ch.addEventListener('message', onMsg)
    const ping = () => {
      const msg: PingMessage = { type: 'ping', tabId, ts: Date.now() }
      ch.postMessage(msg)
      const now = Date.now()
      const m = lastSeenRef.current
      for (const [id, ts] of m) {
        if (now - ts > 12000) m.delete(id)
      }
      setOthers([...m.keys()].filter((id) => id !== tabId).length)
    }
    ping()
    const id = window.setInterval(ping, 4000)
    return () => {
      window.clearInterval(id)
      ch.removeEventListener('message', onMsg)
      ch.close()
    }
  }, [channelKey, tabId])

  if (others <= 0) return null

  return (
    <p className="text-xs text-slate-500 dark:text-neutral-400" role="status">
      This course is open in {others} other tab{others === 1 ? '' : 's'} in this browser.
    </p>
  )
}
