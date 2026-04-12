import {
  Bell,
  Heart,
  MessageCircle,
  MoreHorizontal,
  Pin,
  Pencil,
  Hash,
  Plus,
  Send,
  X,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CourseFileMarkdownImage } from '../../components/syllabus/CourseFileMarkdownImage'
import { FeedComposer } from '../../components/feed/FeedComposer'
import { wsUrl } from '../../lib/api'
import {
  bodyHasEveryoneTag,
  collectMentionUserIdsFromBody,
  createFeedChannel,
  fetchFeedChannels,
  fetchFeedMessages,
  fetchFeedRoster,
  likeFeedMessage,
  patchFeedMessage,
  pinFeedMessage,
  postFeedMessage,
  rosterMentionLabels,
  unlikeFeedMessage,
  type FeedChannel,
  type FeedMessage,
  type FeedRosterPerson,
} from '../../lib/courseFeedApi'
import { fetchCourse, type Course } from '../../lib/coursesApi'
import { getAccessToken, getJwtSubject } from '../../lib/auth'
import { useCourseFeedUnread } from '../../context/useCourseFeedUnread'
import { LmsPage } from './LmsPage'

function isCourseStaff(roles: string[] | undefined): boolean {
  return Boolean(roles?.some((r) => r === 'teacher' || r === 'instructor'))
}

function rosterMap(people: FeedRosterPerson[]): Map<string, FeedRosterPerson> {
  const m = new Map<string, FeedRosterPerson>()
  for (const p of people) {
    m.set(p.userId.toLowerCase(), p)
  }
  return m
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const mentionPillClass =
  'mx-0.5 inline-flex max-w-full items-center rounded-md bg-indigo-100/90 px-1.5 py-0.5 align-baseline text-[0.8125rem] font-semibold text-indigo-800 ring-1 ring-inset ring-indigo-200/60 dark:bg-indigo-950/55 dark:text-indigo-100 dark:ring-indigo-500/25'

function hueFromString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h) % 360
}

function displayInitials(label: string): string {
  const t = label.trim()
  if (!t) return '?'
  const parts = t.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    const a = parts[0][0] ?? ''
    const b = parts[1][0] ?? ''
    return (a + b).toUpperCase() || '?'
  }
  return t.slice(0, 2).toUpperCase() || '?'
}

function formatFeedTime(iso: string): string {
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  if (Number.isNaN(diff) || diff < 0) return d.toLocaleDateString()
  const sec = Math.floor(diff / 1000)
  if (sec < 45) return 'Just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d`
  const sameYear = new Date().getFullYear() === d.getFullYear()
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

function FeedAvatar({
  userId,
  name,
  size = 'md',
}: {
  userId: string
  name: string
  size?: 'sm' | 'md'
}) {
  const h = hueFromString(userId.toLowerCase())
  const h2 = (h + 48) % 360
  const dim = size === 'sm' ? 'h-9 w-9 text-[0.7rem]' : 'h-10 w-10 text-sm'
  return (
    <div
      className={`flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white shadow-sm ring-2 ring-white dark:ring-neutral-950 ${dim}`}
      style={{
        background: `linear-gradient(145deg, hsl(${h} 58% 48%), hsl(${h2} 52% 40%))`,
      }}
      aria-hidden
    >
      {displayInitials(name)}
    </div>
  )
}

function formatMessageBody(
  body: string,
  peopleById: Map<string, FeedRosterPerson>,
  roster: FeedRosterPerson[],
): ReactNode[] {
  const labels = rosterMentionLabels(roster)
  const sorted = [...roster].sort(
    (a, b) => (labels.get(b.userId)!.length - labels.get(a.userId)!.length),
  )
  const bits: string[] = []
  for (const p of sorted) bits.push(escapeRe(labels.get(p.userId)!))
  bits.push('[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
  bits.push('everyone')
  const tokenRe = new RegExp(`@(${bits.join('|')})`, 'gi')
  const out: ReactNode[] = []
  let last = 0
  let mi = 0
  let m: RegExpExecArray | null
  const re = new RegExp(tokenRe.source, tokenRe.flags)
  while ((m = re.exec(body)) !== null) {
    if (m.index > last) out.push(<span key={`t-${mi++}`}>{body.slice(last, m.index)}</span>)
    const raw = m[1]
    const full = m[0]
    if (/^[0-9a-f-]{36}$/i.test(raw) && raw.includes('-')) {
      const id = raw.toLowerCase()
      const p = peopleById.get(id)
      const nm = p ? labels.get(p.userId) ?? p.displayName?.trim() ?? p.email : raw
      out.push(
        <span key={`t-${mi++}`} className={mentionPillClass}>
          @{nm}
        </span>,
      )
    } else if (raw.toLowerCase() === 'everyone') {
      out.push(
        <span
          key={`t-${mi++}`}
          className="mx-0.5 inline-flex items-center rounded-md bg-amber-100/95 px-1.5 py-0.5 align-baseline text-[0.8125rem] font-semibold text-amber-900 ring-1 ring-inset ring-amber-200/70 dark:bg-amber-950/55 dark:text-amber-100 dark:ring-amber-700/35"
        >
          @everyone
        </span>,
      )
    } else {
      out.push(
        <span key={`t-${mi++}`} className={mentionPillClass}>
          @{raw}
        </span>,
      )
    }
    last = m.index + full.length
  }
  if (last < body.length) out.push(<span key={`t-${mi++}`}>{body.slice(last)}</span>)
  return out.length ? out : [<span key="t-0">{body}</span>]
}

function authorLabel(m: FeedMessage): string {
  return m.authorDisplayName?.trim() || m.authorEmail
}

function closeParentDetails(from: Element) {
  const d = from.closest('details')
  if (d) d.open = false
}

const FEED_NOTIF_LS_PREFIX = 'lextures:courseFeedNotifPrefs:v1:'

type FeedNotificationPrefs = {
  /** Email or push when your @handle appears in a message (when supported). */
  onMention: boolean
  /** When someone replies in a thread you started. */
  onReplyToMyPost: boolean
  /** Any new message in this course feed (high volume). */
  onAnyChannelMessage: boolean
  /** When staff uses @everyone in this course. */
  onEveryone: boolean
}

function defaultFeedNotificationPrefs(): FeedNotificationPrefs {
  return {
    onMention: true,
    onReplyToMyPost: true,
    onAnyChannelMessage: false,
    onEveryone: true,
  }
}

function loadFeedNotificationPrefs(courseCode: string): FeedNotificationPrefs {
  try {
    const raw = localStorage.getItem(FEED_NOTIF_LS_PREFIX + courseCode)
    if (!raw) return defaultFeedNotificationPrefs()
    const o = JSON.parse(raw) as Partial<FeedNotificationPrefs>
    const d = defaultFeedNotificationPrefs()
    return {
      onMention: typeof o.onMention === 'boolean' ? o.onMention : d.onMention,
      onReplyToMyPost: typeof o.onReplyToMyPost === 'boolean' ? o.onReplyToMyPost : d.onReplyToMyPost,
      onAnyChannelMessage:
        typeof o.onAnyChannelMessage === 'boolean' ? o.onAnyChannelMessage : d.onAnyChannelMessage,
      onEveryone: typeof o.onEveryone === 'boolean' ? o.onEveryone : d.onEveryone,
    }
  } catch {
    return defaultFeedNotificationPrefs()
  }
}

function saveFeedNotificationPrefs(courseCode: string, prefs: FeedNotificationPrefs) {
  try {
    localStorage.setItem(FEED_NOTIF_LS_PREFIX + courseCode, JSON.stringify(prefs))
  } catch {
    /* ignore quota / private mode */
  }
}

type FeedBodyPart =
  | { type: 'text'; text: string }
  | { type: 'img'; alt: string; src: string }

function splitFeedBodyWithImages(body: string): FeedBodyPart[] {
  const re = /!\[([^\]]*)\]\(([^)]+)\)/g
  const parts: FeedBodyPart[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) {
    if (m.index > last) parts.push({ type: 'text', text: body.slice(last, m.index) })
    parts.push({ type: 'img', alt: m[1], src: m[2].trim() })
    last = m.index + m[0].length
  }
  if (last < body.length) parts.push({ type: 'text', text: body.slice(last) })
  if (parts.length === 0) parts.push({ type: 'text', text: body })
  return parts
}

/** Only same-origin course file blobs may render as images in the feed. */
function isFeedEmbeddedCourseImageUrl(src: string): boolean {
  return /^\/api\/v1\/courses\/[^/]+\/course-files\/[0-9a-f-]+\/content$/i.test(src.trim())
}

function FeedMessageBody({
  body,
  peopleById,
  roster,
}: {
  body: string
  peopleById: Map<string, FeedRosterPerson>
  roster: FeedRosterPerson[]
}) {
  const parts = useMemo(() => splitFeedBodyWithImages(body), [body])
  return (
    <div className="space-y-2">
      {parts.map((part, i) => {
        if (part.type === 'text') {
          if (!part.text) return null
          return (
            <p
              key={`t-${i}`}
              className="whitespace-pre-wrap text-[0.9375rem] leading-relaxed text-slate-800 dark:text-neutral-100"
            >
              {formatMessageBody(part.text, peopleById, roster)}
            </p>
          )
        }
        if (!isFeedEmbeddedCourseImageUrl(part.src)) {
          return (
            <p key={`i-${i}`} className="text-xs text-slate-400 dark:text-neutral-500">
              [Image link not allowed]
            </p>
          )
        }
        return (
          <CourseFileMarkdownImage
            key={`i-${i}`}
            src={part.src}
            alt={part.alt || 'Attached image'}
            className="max-h-[min(24rem,70vh)] w-auto max-w-full rounded-lg border border-slate-200 dark:border-neutral-700"
          />
        )
      })}
    </div>
  )
}

export default function CourseFeedPage() {
  const { courseCode } = useParams<{ courseCode: string }>()
  const [course, setCourse] = useState<Course | null>(null)
  const [channels, setChannels] = useState<FeedChannel[]>([])
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null)
  const [roster, setRoster] = useState<FeedRosterPerson[]>([])
  const [messages, setMessages] = useState<FeedMessage[]>([])
  const [composer, setComposer] = useState('')
  const [newChannelName, setNewChannelName] = useState('')
  const [newChannelModalOpen, setNewChannelModalOpen] = useState(false)
  const [creatingChannel, setCreatingChannel] = useState(false)
  const [replyTo, setReplyTo] = useState<FeedMessage | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [expandedReplyRoots, setExpandedReplyRoots] = useState<Set<string>>(() => new Set())
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [feedImageUploading, setFeedImageUploading] = useState(false)
  const [notifPrefsOpen, setNotifPrefsOpen] = useState(false)
  const [notifPrefsDraft, setNotifPrefsDraft] = useState<FeedNotificationPrefs>(() =>
    defaultFeedNotificationPrefs(),
  )

  const viewerId = useMemo(() => getJwtSubject(), [])
  const { feedUnreadForChannel, clearFeedChannelUnread, setViewedFeedChannel } =
    useCourseFeedUnread()
  const staff = isCourseStaff(course?.viewerEnrollmentRoles)
  const peopleById = useMemo(() => rosterMap(roster), [roster])

  useEffect(() => {
    if (!courseCode) return
    setViewedFeedChannel(courseCode, activeChannelId)
    return () => setViewedFeedChannel(null, null)
  }, [courseCode, activeChannelId, setViewedFeedChannel])

  useEffect(() => {
    if (!courseCode || !activeChannelId) return
    clearFeedChannelUnread(courseCode, activeChannelId)
  }, [courseCode, activeChannelId, clearFeedChannelUnread])

  const reloadChannels = useCallback(async () => {
    if (!courseCode) return
    const ch = await fetchFeedChannels(courseCode)
    setChannels(ch)
    setActiveChannelId((prev) => {
      if (prev && ch.some((c) => c.id === prev)) return prev
      return ch[0]?.id ?? null
    })
  }, [courseCode])

  const reloadMessages = useCallback(async () => {
    if (!courseCode || !activeChannelId) {
      setMessages([])
      return
    }
    const m = await fetchFeedMessages(courseCode, activeChannelId)
    setMessages(m)
  }, [courseCode, activeChannelId])

  const reloadMessagesRef = useRef(reloadMessages)
  const reloadChannelsRef = useRef(reloadChannels)
  const activeChannelIdRef = useRef(activeChannelId)
  reloadMessagesRef.current = reloadMessages
  reloadChannelsRef.current = reloadChannels
  activeChannelIdRef.current = activeChannelId

  const feedScrollRef = useRef<HTMLDivElement>(null)
  /** User is within this many px of the bottom — treat as "following" the live tail. */
  const stickToBottomRef = useRef(true)
  const pendingSnapBottomRef = useRef(true)

  const scrollFeedToBottom = useCallback((behavior: ScrollBehavior) => {
    const el = feedScrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior })
  }, [])

  useEffect(() => {
    if (!courseCode) return
    const token = getAccessToken()
    if (!token) return
    const url = `${wsUrl(`/api/v1/courses/${encodeURIComponent(courseCode)}/feed/ws`)}?token=${encodeURIComponent(token)}`
    const ws = new WebSocket(url)
    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(String(ev.data)) as {
          type?: string
          scope?: string
          channelId?: string
          activity?: string
          actorUserId?: string
        }
        if (data.type !== 'feed') return
        if (data.scope === 'channels') void reloadChannelsRef.current()
        if (
          data.scope === 'messages' &&
          data.channelId &&
          data.channelId === activeChannelIdRef.current
        ) {
          void reloadMessagesRef.current()
        }
      } catch {
        /* ignore malformed */
      }
    }
    return () => {
      ws.close()
    }
  }, [courseCode])

  useEffect(() => {
    if (!courseCode) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const [c, r] = await Promise.all([
          fetchCourse(courseCode),
          fetchFeedRoster(courseCode),
        ])
        if (!cancelled) {
          setCourse(c)
          setRoster(r)
        }
        await reloadChannels()
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not load feed.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [courseCode, reloadChannels])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await reloadMessages()
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not load messages.')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [reloadMessages])

  useEffect(() => {
    setExpandedReplyRoots(new Set())
    stickToBottomRef.current = true
    pendingSnapBottomRef.current = true
  }, [activeChannelId])

  useLayoutEffect(() => {
    if (loading) return
    const el = feedScrollRef.current
    if (!el || messages.length === 0) return
    if (pendingSnapBottomRef.current) {
      pendingSnapBottomRef.current = false
      stickToBottomRef.current = true
      scrollFeedToBottom('auto')
      return
    }
    if (stickToBottomRef.current) scrollFeedToBottom('smooth')
  }, [messages, loading, scrollFeedToBottom])

  const toggleRepliesExpanded = useCallback((rootMessageId: string) => {
    setExpandedReplyRoots((prev) => {
      const next = new Set(prev)
      if (next.has(rootMessageId)) next.delete(rootMessageId)
      else next.add(rootMessageId)
      return next
    })
  }, [])

  const sendMessage = async () => {
    if (!courseCode || !activeChannelId) return
    const text = composer.trim()
    if (!text) return
    const everyone = staff && bodyHasEveryoneTag(text)
    const mentionIds = collectMentionUserIdsFromBody(text, roster)
    setSending(true)
    setError(null)
    try {
      await postFeedMessage(courseCode, activeChannelId, {
        body: text,
        parentMessageId: replyTo?.id ?? null,
        mentionUserIds: mentionIds,
        mentionsEveryone: everyone,
      })
      setComposer('')
      setReplyTo(null)
      await reloadMessages()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send.')
    } finally {
      setSending(false)
    }
  }

  const onCreateChannel = async () => {
    if (!courseCode) return
    const name = newChannelName.trim()
    if (!name) return
    setError(null)
    setCreatingChannel(true)
    try {
      const ch = await createFeedChannel(courseCode, name)
      setNewChannelName('')
      setNewChannelModalOpen(false)
      await reloadChannels()
      setActiveChannelId(ch.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create channel.')
    } finally {
      setCreatingChannel(false)
    }
  }

  useEffect(() => {
    if (!newChannelModalOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !creatingChannel) setNewChannelModalOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [newChannelModalOpen, creatingChannel])

  useEffect(() => {
    if (!notifPrefsOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNotifPrefsOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [notifPrefsOpen])

  const toggleLike = async (messageId: string, liked: boolean) => {
    if (!courseCode) return
    try {
      if (liked) await unlikeFeedMessage(courseCode, messageId)
      else await likeFeedMessage(courseCode, messageId)
      await reloadMessages()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update like.')
    }
  }

  const togglePin = async (messageId: string, pinned: boolean) => {
    if (!courseCode) return
    try {
      await pinFeedMessage(courseCode, messageId, pinned)
      await reloadMessages()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not pin.')
    }
  }

  const saveEdit = async (messageId: string) => {
    if (!courseCode) return
    const body = editDraft.trim()
    if (!body) return
    try {
      await patchFeedMessage(courseCode, messageId, body)
      setEditingId(null)
      await reloadMessages()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save edit.')
    }
  }

  if (!courseCode) {
    return (
      <LmsPage title="Feed" description="">
        <p className="mt-6 text-sm text-slate-500">Invalid link.</p>
      </LmsPage>
    )
  }

  const title = course ? `Feed — ${course.title}` : 'Feed'

  const titleContent = (
    <div>
      <div className="flex items-start gap-1.5 sm:gap-2">
        <h1 className="min-w-0 flex-1 text-2xl font-semibold tracking-tight text-slate-900 dark:text-neutral-100">
          {title}
        </h1>
        <details className="group/feed-title-menu relative shrink-0 pt-0.5">
          <summary
            className="list-none cursor-pointer rounded-lg p-1.5 text-slate-400 outline-none hover:bg-slate-100 hover:text-slate-600 dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-300 [&::-webkit-details-marker]:hidden"
            aria-label="Feed page menu"
          >
            <MoreHorizontal className="h-6 w-6" aria-hidden />
          </summary>
          <div
            className="absolute right-0 top-full z-40 mt-1 min-w-[14rem] overflow-hidden rounded-xl border border-slate-200/90 bg-white py-1 text-sm shadow-lg ring-1 ring-black/5 dark:border-neutral-700 dark:bg-neutral-900 dark:ring-white/10"
            onMouseDown={(ev) => ev.preventDefault()}
          >
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-slate-700 hover:bg-slate-50 dark:text-neutral-200 dark:hover:bg-neutral-800"
              onClick={(e) => {
                closeParentDetails(e.currentTarget)
                setNotifPrefsDraft(loadFeedNotificationPrefs(courseCode))
                setNotifPrefsOpen(true)
              }}
            >
              <Bell className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
              Notification Preferences
            </button>
          </div>
        </details>
      </div>
    </div>
  )

  return (
    <LmsPage
      fillHeight
      title={title}
      titleContent={titleContent}
      description="Course channels with replies, mentions, and pins."
    >
      {loading && <p className="text-sm text-slate-500 dark:text-neutral-400">Loading…</p>}
      {error && (
        <p className="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-100">
          {error}
        </p>
      )}

      {notifPrefsOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-900/40 p-4 sm:items-center dark:bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="feed-notif-prefs-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setNotifPrefsOpen(false)
          }}
        >
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-950">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-neutral-800">
              <div className="flex min-w-0 items-center gap-2">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-200">
                  <Bell className="h-4 w-4" aria-hidden />
                </span>
                <h3
                  id="feed-notif-prefs-title"
                  className="text-sm font-semibold text-slate-900 dark:text-neutral-100"
                >
                  Notification Preferences
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setNotifPrefsOpen(false)}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                aria-label="Close"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <div className="max-h-[min(28rem,70vh)] space-y-4 overflow-y-auto px-4 py-4">
              <p className="text-xs leading-relaxed text-slate-500 dark:text-neutral-400">
                Choose what you want to be notified about for this course feed. Preferences are
                stored on this device for this course until account-wide delivery is connected.
              </p>
              <fieldset className="space-y-3">
                <legend className="sr-only">Feed notification options</legend>
                <label className="flex cursor-pointer gap-3 rounded-xl border border-transparent px-1 py-1 hover:border-slate-100 hover:bg-slate-50/80 dark:hover:border-neutral-800 dark:hover:bg-neutral-900/60">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-neutral-600 dark:bg-neutral-900"
                    checked={notifPrefsDraft.onMention}
                    onChange={(e) =>
                      setNotifPrefsDraft((p) => ({ ...p, onMention: e.target.checked }))
                    }
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-slate-900 dark:text-neutral-100">
                      When someone @mentions me
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-500 dark:text-neutral-400">
                      Includes messages where your name appears after @.
                    </span>
                  </span>
                </label>
                <label className="flex cursor-pointer gap-3 rounded-xl border border-transparent px-1 py-1 hover:border-slate-100 hover:bg-slate-50/80 dark:hover:border-neutral-800 dark:hover:bg-neutral-900/60">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-neutral-600 dark:bg-neutral-900"
                    checked={notifPrefsDraft.onReplyToMyPost}
                    onChange={(e) =>
                      setNotifPrefsDraft((p) => ({ ...p, onReplyToMyPost: e.target.checked }))
                    }
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-slate-900 dark:text-neutral-100">
                      When someone replies to my post
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-500 dark:text-neutral-400">
                      Replies in threads you started at the top level.
                    </span>
                  </span>
                </label>
                <label className="flex cursor-pointer gap-3 rounded-xl border border-transparent px-1 py-1 hover:border-slate-100 hover:bg-slate-50/80 dark:hover:border-neutral-800 dark:hover:bg-neutral-900/60">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-neutral-600 dark:bg-neutral-900"
                    checked={notifPrefsDraft.onAnyChannelMessage}
                    onChange={(e) =>
                      setNotifPrefsDraft((p) => ({ ...p, onAnyChannelMessage: e.target.checked }))
                    }
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-slate-900 dark:text-neutral-100">
                      Every new message in the feed
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-500 dark:text-neutral-400">
                      Can be frequent in active channels.
                    </span>
                  </span>
                </label>
                <label className="flex cursor-pointer gap-3 rounded-xl border border-transparent px-1 py-1 hover:border-slate-100 hover:bg-slate-50/80 dark:hover:border-neutral-800 dark:hover:bg-neutral-900/60">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-neutral-600 dark:bg-neutral-900"
                    checked={notifPrefsDraft.onEveryone}
                    onChange={(e) =>
                      setNotifPrefsDraft((p) => ({ ...p, onEveryone: e.target.checked }))
                    }
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-slate-900 dark:text-neutral-100">
                      When staff uses @everyone
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-500 dark:text-neutral-400">
                      Whole-class announcements from instructors.
                    </span>
                  </span>
                </label>
              </fieldset>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/80 px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900/60">
              <button
                type="button"
                onClick={() => setNotifPrefsOpen(false)}
                className="rounded-xl px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  saveFeedNotificationPrefs(courseCode, notifPrefsDraft)
                  setNotifPrefsOpen(false)
                }}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 dark:shadow-none"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {!loading && (
        <div className="flex min-h-0 flex-1 flex-col gap-4 md:flex-row">
          <aside className="flex w-full shrink-0 flex-col rounded-2xl border border-slate-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-950 md:h-auto md:w-56">
            <div className="flex items-center justify-between gap-2 px-1 pb-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-neutral-400">
                Channels
              </p>
              <button
                type="button"
                onClick={() => {
                  setNewChannelName('')
                  setNewChannelModalOpen(true)
                }}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                aria-label="New channel"
              >
                <Plus className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <div className="flex flex-col gap-0.5">
              {channels.map((ch) => {
                const chUnread = feedUnreadForChannel(courseCode, ch.id)
                return (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => setActiveChannelId(ch.id)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm font-medium ${
                      ch.id === activeChannelId
                        ? 'bg-indigo-50 text-indigo-900 dark:bg-indigo-950/50 dark:text-indigo-100'
                        : 'text-slate-700 hover:bg-slate-50 dark:text-neutral-200 dark:hover:bg-neutral-900'
                    }`}
                  >
                    <Hash className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{ch.name}</span>
                    {chUnread > 0 ? (
                      <span
                        className="min-w-[1.25rem] shrink-0 rounded-full bg-indigo-600 px-1.5 py-0.5 text-center text-[0.65rem] font-bold leading-none text-white tabular-nums dark:bg-indigo-500"
                        aria-label={`${chUnread} new ${chUnread === 1 ? 'post' : 'posts'} in ${ch.name}`}
                      >
                        {chUnread > 99 ? '99+' : chUnread}
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </div>
          </aside>

          {newChannelModalOpen && (
            <div
              className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center dark:bg-black/50"
              role="dialog"
              aria-modal="true"
              aria-labelledby="feed-new-channel-title"
              onClick={(e) => {
                if (e.target === e.currentTarget && !creatingChannel) setNewChannelModalOpen(false)
              }}
            >
              <div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-950">
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-neutral-800">
                  <h3 id="feed-new-channel-title" className="text-sm font-semibold text-slate-900 dark:text-neutral-100">
                    New channel
                  </h3>
                  <button
                    type="button"
                    onClick={() => !creatingChannel && setNewChannelModalOpen(false)}
                    disabled={creatingChannel}
                    className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                    aria-label="Close"
                  >
                    <X className="h-5 w-5" aria-hidden />
                  </button>
                </div>
                <div className="p-4">
                  <label className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-neutral-400" htmlFor="feed-new-channel-name">
                    Channel name
                  </label>
                  <input
                    id="feed-new-channel-name"
                    value={newChannelName}
                    onChange={(e) => setNewChannelName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !creatingChannel) {
                        e.preventDefault()
                        void onCreateChannel()
                      }
                    }}
                    placeholder="e.g. announcements"
                    autoFocus
                    disabled={creatingChannel}
                    maxLength={80}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/30 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:border-indigo-500 dark:focus:ring-indigo-500/30"
                  />
                </div>
                <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/80 px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900/60">
                  <button
                    type="button"
                    onClick={() => !creatingChannel && setNewChannelModalOpen(false)}
                    disabled={creatingChannel}
                    className="rounded-xl px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:text-neutral-300 dark:hover:bg-neutral-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void onCreateChannel()}
                    disabled={creatingChannel || !newChannelName.trim()}
                    className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50 dark:disabled:opacity-40"
                  >
                    {creatingChannel ? 'Creating…' : 'Create'}
                  </button>
                </div>
              </div>
            </div>
          )}

          <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-950 dark:shadow-none">
            <div className="shrink-0 border-b border-slate-100 bg-gradient-to-b from-slate-50/80 to-white px-5 py-4 dark:border-neutral-800 dark:from-neutral-900/80 dark:to-neutral-950">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-200">
                  <Hash className="h-4 w-4" aria-hidden />
                </span>
                <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-neutral-50">
                  {channels.find((c) => c.id === activeChannelId)?.name ?? 'Channel'}
                </h2>
              </div>
              <details className="mt-2">
                <summary className="cursor-pointer select-none list-none text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-neutral-500 dark:hover:text-neutral-200 [&::-webkit-details-marker]:hidden">
                  Composer tips
                </summary>
                <p className="mt-2 max-w-md text-xs leading-relaxed text-slate-500 dark:text-neutral-400">
                  Type @ for people.
                  {staff ? ' Instructors can use @everyone. ' : ' '}
                  Enter sends; Shift+Enter starts a new line.
                </p>
              </details>
            </div>

            <div className="flex min-h-0 flex-1 flex-col">
              <div
                ref={feedScrollRef}
                onScroll={(e) => {
                  const el = e.currentTarget
                  const slack = 120
                  stickToBottomRef.current =
                    el.scrollHeight - el.scrollTop - el.clientHeight <= slack
                }}
                className="min-h-0 flex-1 overflow-y-auto px-4 py-2 sm:px-5"
              >
                {messages.map((m) => (
                  <article
                    key={m.id}
                    className="border-b border-slate-100 py-5 last:border-b-0 last:pb-4 dark:border-neutral-800/80"
                  >
                    <MessageBlock
                      message={m}
                      depth={0}
                      roster={roster}
                      peopleById={peopleById}
                      viewerId={viewerId}
                      staff={staff}
                      editingId={editingId}
                      editDraft={editDraft}
                      onStartEdit={(msg) => {
                        setEditingId(msg.id)
                        setEditDraft(msg.body)
                      }}
                      onEditDraft={setEditDraft}
                      onCancelEdit={() => setEditingId(null)}
                      onSaveEdit={() => void saveEdit(m.id)}
                      onReply={() => {
                        setExpandedReplyRoots((s) => new Set(s).add(m.id))
                        setReplyTo(m)
                      }}
                      onToggleLike={() => void toggleLike(m.id, m.viewerHasLiked)}
                      onTogglePin={() => void togglePin(m.id, !m.pinnedAt)}
                    />
                    {m.replies.length > 0 && (
                      <>
                        <button
                          type="button"
                          onClick={() => toggleRepliesExpanded(m.id)}
                          className="group/replylink ml-14 mt-3 flex items-center gap-2 rounded-lg py-1.5 pl-1 pr-2 text-left text-sm font-medium text-indigo-600 hover:bg-indigo-50/80 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
                          aria-expanded={expandedReplyRoots.has(m.id)}
                        >
                          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-slate-500 ring-1 ring-slate-200/80 transition group-hover/replylink:bg-white group-hover/replylink:text-indigo-600 dark:bg-neutral-800 dark:text-neutral-400 dark:ring-neutral-700 dark:group-hover/replylink:bg-neutral-900 dark:group-hover/replylink:text-indigo-300">
                            <MessageCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                          </span>
                          {expandedReplyRoots.has(m.id)
                            ? 'Hide replies'
                            : `${m.replies.length} ${m.replies.length === 1 ? 'reply' : 'replies'}`}
                        </button>
                        {expandedReplyRoots.has(m.id) && (
                          <div className="ml-3 mt-4 space-y-1 border-l-2 border-slate-200/90 pl-4 dark:border-neutral-700">
                            {m.replies.map((r) => (
                              <div key={r.id} className="py-3 pl-1">
                              <MessageBlock
                                message={r}
                                depth={1}
                                roster={roster}
                                peopleById={peopleById}
                                viewerId={viewerId}
                                staff={staff}
                                editingId={editingId}
                                editDraft={editDraft}
                                onStartEdit={(msg) => {
                                  setEditingId(msg.id)
                                  setEditDraft(msg.body)
                                }}
                                onEditDraft={setEditDraft}
                                onCancelEdit={() => setEditingId(null)}
                                onSaveEdit={() => void saveEdit(r.id)}
                                onReply={() => {
                                  setExpandedReplyRoots((s) => new Set(s).add(m.id))
                                  setReplyTo(m)
                                }}
                                onToggleLike={() => void toggleLike(r.id, r.viewerHasLiked)}
                                onTogglePin={() => {}}
                              />
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </article>
                ))}
                {messages.length === 0 && (
                  <p className="text-sm text-slate-500 dark:text-neutral-400">No messages yet.</p>
                )}
              </div>

              <div className="shrink-0 border-t border-slate-200 px-5 py-4 dark:border-neutral-800">
                {replyTo && (
                  <div className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-neutral-900">
                    <span className="truncate text-slate-600 dark:text-neutral-300">
                      Replying to <strong>{authorLabel(replyTo)}</strong>
                    </span>
                    <button
                      type="button"
                      className="shrink-0 rounded p-1 hover:bg-slate-200 dark:hover:bg-neutral-800"
                      aria-label="Cancel reply"
                      onClick={() => setReplyTo(null)}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}
                <div className="flex gap-2">
                  <div className="min-w-0 flex-1">
                    <FeedComposer
                      courseCode={courseCode}
                      value={composer}
                      onChange={setComposer}
                      roster={roster}
                      viewerUserId={viewerId}
                      staff={staff}
                      placeholder={replyTo ? 'Write a reply…' : 'Message this channel…'}
                      disabled={sending}
                      onImageBusyChange={setFeedImageUploading}
                      onSubmit={() => void sendMessage()}
                    />
                  </div>
                  <button
                    type="button"
                    disabled={sending || feedImageUploading || !composer.trim()}
                    onClick={() => void sendMessage()}
                    className="self-end rounded-xl bg-indigo-600 p-3 text-white hover:bg-indigo-500 disabled:opacity-40"
                    aria-label="Send"
                  >
                    <Send className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>
      )}
    </LmsPage>
  )
}

type MessageBlockProps = {
  message: FeedMessage
  depth: number
  roster: FeedRosterPerson[]
  peopleById: Map<string, FeedRosterPerson>
  viewerId: string | null
  staff: boolean
  editingId: string | null
  editDraft: string
  onStartEdit: (m: FeedMessage) => void
  onEditDraft: (s: string) => void
  onCancelEdit: () => void
  onSaveEdit: () => void
  onReply: () => void
  onToggleLike: () => void
  onTogglePin: () => void
}

function MessageBlock({
  message: m,
  depth,
  roster,
  peopleById,
  viewerId,
  staff,
  editingId,
  editDraft,
  onStartEdit,
  onEditDraft,
  onCancelEdit,
  onSaveEdit,
  onReply,
  onToggleLike,
  onTogglePin,
}: MessageBlockProps) {
  const mine =
    viewerId !== null && m.authorUserId.toLowerCase() === viewerId.toLowerCase()
  const editing = editingId === m.id
  const showActionsMenu = !editing && (depth === 0 || mine)
  const author = authorLabel(m)
  const avatarSize = depth === 0 ? 'md' : 'sm'

  return (
    <div className="group/msg rounded-xl px-1 py-0.5 transition-colors hover:bg-slate-50/70 dark:hover:bg-neutral-900/50">
      <div className="flex gap-3">
        <FeedAvatar userId={m.authorUserId} name={author} size={avatarSize} />
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="truncate text-[0.9375rem] font-semibold text-slate-900 dark:text-neutral-50">
                  {author}
                </span>
                <span className="text-slate-300 dark:text-neutral-600" aria-hidden>
                  ·
                </span>
                <time
                  className="shrink-0 text-xs font-medium text-slate-400 dark:text-neutral-500"
                  dateTime={m.createdAt}
                  title={new Date(m.createdAt).toLocaleString()}
                >
                  {formatFeedTime(m.createdAt)}
                </time>
                {m.editedAt && (
                  <span className="text-xs font-medium text-slate-400 dark:text-neutral-500">
                    · edited
                  </span>
                )}
                {m.pinnedAt && (
                  <span
                    className="inline-flex items-center gap-0.5 rounded-full bg-amber-50 px-1.5 py-px text-[0.65rem] font-medium text-amber-800 ring-1 ring-amber-200/60 dark:bg-amber-950/50 dark:text-amber-200 dark:ring-amber-800/50"
                    title="Pinned"
                  >
                    <Pin className="h-2.5 w-2.5" aria-hidden />
                    Pinned
                  </span>
                )}
                {m.mentionsEveryone && (
                  <span className="rounded-full bg-amber-100 px-2 py-px text-[0.65rem] font-semibold text-amber-900 ring-1 ring-amber-200/70 dark:bg-amber-950/45 dark:text-amber-100 dark:ring-amber-800/40">
                    @everyone
                  </span>
                )}
              </div>
            </div>
            {showActionsMenu && (
              <details className="group/menu relative shrink-0 -mr-1 -mt-0.5">
                <summary
                  className="list-none cursor-pointer rounded-full p-1.5 text-slate-400 outline-none hover:bg-slate-200/80 hover:text-slate-600 dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-300 [&::-webkit-details-marker]:hidden"
                  aria-label="Message actions"
                >
                  <MoreHorizontal className="h-4 w-4" aria-hidden />
                </summary>
                <div className="absolute right-0 top-full z-30 mt-1 min-w-[10.5rem] overflow-hidden rounded-xl border border-slate-200/90 bg-white py-1 text-sm shadow-lg ring-1 ring-black/5 dark:border-neutral-700 dark:bg-neutral-900 dark:ring-white/10">
                  {depth === 0 && (
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-slate-700 hover:bg-slate-50 dark:text-neutral-200 dark:hover:bg-neutral-800"
                      onClick={(e) => {
                        closeParentDetails(e.currentTarget)
                        onReply()
                      }}
                    >
                      <MessageCircle className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
                      Reply
                    </button>
                  )}
                  {mine && (
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-slate-700 hover:bg-slate-50 dark:text-neutral-200 dark:hover:bg-neutral-800"
                      onClick={(e) => {
                        closeParentDetails(e.currentTarget)
                        onStartEdit(m)
                      }}
                    >
                      <Pencil className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
                      Edit
                    </button>
                  )}
                  {staff && depth === 0 && (
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-slate-700 hover:bg-slate-50 dark:text-neutral-200 dark:hover:bg-neutral-800"
                      onClick={(e) => {
                        closeParentDetails(e.currentTarget)
                        onTogglePin()
                      }}
                    >
                      <Pin className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
                      {m.pinnedAt ? 'Unpin' : 'Pin'}
                    </button>
                  )}
                </div>
              </details>
            )}
          </div>
          {editing ? (
            <div className="mt-3 space-y-2">
              <textarea
                value={editDraft}
                onChange={(e) => onEditDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    onSaveEdit()
                  }
                }}
                rows={3}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-inner dark:border-neutral-700 dark:bg-neutral-900"
                maxLength={8000}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-indigo-500"
                  onClick={onSaveEdit}
                >
                  Save
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium dark:border-neutral-700"
                  onClick={onCancelEdit}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-1.5">
              <FeedMessageBody body={m.body} peopleById={peopleById} roster={roster} />
            </div>
          )}
          {!editing && (
            <div className="mt-3 flex flex-wrap items-center gap-1">
              <button
                type="button"
                onClick={onToggleLike}
                title={m.viewerHasLiked ? 'Unlike' : 'Like'}
                aria-label={
                  m.likeCount > 0
                    ? `${m.viewerHasLiked ? 'Unlike' : 'Like'}, ${m.likeCount}`
                    : m.viewerHasLiked
                      ? 'Unlike'
                      : 'Like'
                }
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-medium transition-colors ${
                  m.viewerHasLiked
                    ? 'bg-rose-50 text-rose-600 hover:bg-rose-100 dark:bg-rose-950/35 dark:text-rose-400 dark:hover:bg-rose-950/55'
                    : m.likeCount > 0
                      ? 'text-rose-500/95 hover:bg-rose-50 dark:text-rose-400/90 dark:hover:bg-rose-950/30'
                      : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-300'
                }`}
              >
                <Heart
                  className={`h-4 w-4 shrink-0 ${m.viewerHasLiked ? 'fill-current' : ''}`}
                  aria-hidden
                />
                {m.likeCount > 0 ? (
                  <span className="tabular-nums">{m.likeCount}</span>
                ) : null}
              </button>
              {depth === 0 && (
                <button
                  type="button"
                  onClick={onReply}
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                >
                  <MessageCircle className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
                  Reply
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
