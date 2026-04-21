import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { matchPath, useLocation } from 'react-router-dom'
import { getAccessToken, getJwtSubject } from '../lib/auth'
import { wsUrl } from '../lib/api'
import { CourseFeedUnreadContext } from './course-feed-unread-context'

/** courseCode -> channelId -> count */
type NestedCounts = Record<string, Record<string, number>>

export function CourseFeedUnreadProvider({ children }: { children: ReactNode }) {
  const location = useLocation()
  const pathnameRef = useRef(location.pathname)
  useLayoutEffect(() => {
    pathnameRef.current = location.pathname
  }, [location.pathname])

  const [counts, setCounts] = useState<NestedCounts>({})

  const viewedFeedRef = useRef<{ courseCode: string | null; channelId: string | null }>({
    courseCode: null,
    channelId: null,
  })

  const setViewedFeedChannel = useCallback((courseCode: string | null, channelId: string | null) => {
    viewedFeedRef.current = {
      courseCode,
      channelId: channelId ? channelId.toLowerCase() : null,
    }
  }, [])

  const courseMatch = useMemo(
    () => matchPath({ path: '/courses/:courseCode', end: false }, location.pathname),
    [location.pathname],
  )
  const activeCourseCode = courseMatch?.params.courseCode

  const clearFeedChannelUnread = useCallback((code: string, channelId: string) => {
    const key = channelId.toLowerCase()
    setCounts((c) => {
      const byCh = c[code]
      if (!byCh || !byCh[key]) return c
      const nextBy = { ...byCh }
      delete nextBy[key]
      const empty = Object.keys(nextBy).length === 0
      if (empty) {
        const rest = { ...c }
        delete rest[code]
        return rest
      }
      return { ...c, [code]: nextBy }
    })
  }, [])

  const feedUnreadForChannel = useCallback(
    (code: string, channelId: string) => counts[code]?.[channelId.toLowerCase()] ?? 0,
    [counts],
  )

  const totalFeedUnread = useMemo(() => {
    let n = 0
    for (const byCh of Object.values(counts)) {
      for (const v of Object.values(byCh)) {
        n += v
      }
    }
    return n
  }, [counts])

  useEffect(() => {
    if (!activeCourseCode) return
    const token = getAccessToken()
    if (!token) return

    const url = wsUrl(`/api/v1/courses/${encodeURIComponent(activeCourseCode)}/feed/ws`)
    const ws = new WebSocket(url)
    ws.onopen = () => {
      ws.send(JSON.stringify({ authToken: token }))
    }

    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(String(ev.data)) as {
          type?: string
          scope?: string
          channelId?: string
          activity?: string
          actorUserId?: string
        }
        if (data.type !== 'feed' || data.scope !== 'messages') return
        if (data.activity !== 'post') return
        const channelIdRaw = data.channelId
        if (!channelIdRaw) return
        const channelKey = channelIdRaw.toLowerCase()

        const viewer = getJwtSubject()
        const actor = data.actorUserId?.toLowerCase() ?? ''
        if (viewer && actor === viewer.toLowerCase()) return

        const path = pathnameRef.current
        const onThisCourseFeed =
          matchPath({ path: '/courses/:courseCode/feed', end: true }, path)?.params.courseCode ===
          activeCourseCode

        const v = viewedFeedRef.current
        const viewingThisChannel =
          onThisCourseFeed &&
          v.courseCode === activeCourseCode &&
          v.channelId != null &&
          v.channelId === channelKey
        if (viewingThisChannel) return

        setCounts((c) => {
          const prevCourse = c[activeCourseCode] ?? {}
          const n = (prevCourse[channelKey] ?? 0) + 1
          return {
            ...c,
            [activeCourseCode]: { ...prevCourse, [channelKey]: n },
          }
        })
      } catch {
        /* ignore malformed */
      }
    }

    return () => {
      ws.close()
    }
  }, [activeCourseCode])

  const value = useMemo(
    () => ({
      feedUnreadForChannel,
      clearFeedChannelUnread,
      setViewedFeedChannel,
      totalFeedUnread,
    }),
    [feedUnreadForChannel, clearFeedChannelUnread, setViewedFeedChannel, totalFeedUnread],
  )

  return (
    <CourseFeedUnreadContext.Provider value={value}>{children}</CourseFeedUnreadContext.Provider>
  )
}
