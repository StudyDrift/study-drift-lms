import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Bell, ClipboardCheck, Inbox, Megaphone, MessageCircle, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  fetchUnifiedNotifications,
  type UnifiedNotification,
  type UnifiedNotificationKind,
} from '../../lib/unified-notifications'
import { formatTimeAgoFromIso } from '../../lib/format-time-ago'
import { useCourseFeedUnread } from '../../context/use-course-feed-unread'
import { useInboxUnreadCount, useMailboxRevision } from '../../context/use-inbox-unread'

const FILTER_TABS: { id: 'all' | UnifiedNotificationKind; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'inbox', label: 'Inbox' },
  { id: 'feed_mention', label: 'Feed' },
  { id: 'graded', label: 'Grades' },
  { id: 'announcement', label: 'Announcements' },
]

function kindIcon(kind: UnifiedNotificationKind) {
  switch (kind) {
    case 'inbox':
      return Inbox
    case 'feed_mention':
      return MessageCircle
    case 'announcement':
      return Megaphone
    case 'graded':
      return ClipboardCheck
  }
}

export function NotificationsDrawerTrigger({
  open,
  onOpen,
}: {
  open: boolean
  onOpen: () => void
}) {
  const inboxUnread = useInboxUnreadCount()
  const { totalFeedUnread } = useCourseFeedUnread()
  const badge = Math.min(99, inboxUnread + totalFeedUnread)
  return (
    <button
      type="button"
      className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-600 transition hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/30 dark:text-neutral-300 dark:hover:bg-neutral-800"
      aria-label="Notifications"
      aria-expanded={open}
      aria-haspopup="dialog"
      onClick={onOpen}
    >
      <Bell className="h-5 w-5" aria-hidden />
      {badge > 0 ? (
        <span className="absolute right-1.5 top-1.5 flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full bg-indigo-600 px-1 text-[10px] font-semibold text-white dark:bg-indigo-500">
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
    </button>
  )
}

export function NotificationsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const closeBtnRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const descId = useId()
  const [filter, setFilter] = useState<'all' | UnifiedNotificationKind>('all')
  const [items, setItems] = useState<UnifiedNotification[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mailboxRevision = useMailboxRevision()

  useEffect(() => {
    if (open) return
    setFilter('all')
  }, [open])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const next = await fetchUnifiedNotifications()
      setItems(next)
    } catch {
      setError('Could not load notifications.')
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    void load()
  }, [open, load, mailboxRevision])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => closeBtnRef.current?.focus(), 0)
    return () => window.clearTimeout(t)
  }, [open])

  const filtered = useMemo(() => {
    if (filter === 'all') return items
    return items.filter((i) => i.kind === filter)
  }, [items, filter])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[60] flex justify-end">
      <button
        type="button"
        aria-label="Close notifications"
        className="absolute inset-0 bg-slate-900/45 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="relative flex h-dvh w-[min(100%,22rem)] flex-col border-l border-slate-200 bg-white shadow-2xl shadow-slate-900/20 dark:border-neutral-700 dark:bg-neutral-900 dark:shadow-black/50 sm:w-[26rem]"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-neutral-700">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold tracking-tight text-slate-900 dark:text-neutral-100">
              Notifications
            </h2>
            <p id={descId} className="mt-0.5 text-xs text-slate-500 dark:text-neutral-400">
              Inbox, feed, grades, and announcements in one place.
            </p>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div
          role="group"
          aria-label="Filter notifications by type"
          className="flex shrink-0 gap-1 overflow-x-auto border-b border-slate-100 px-2 py-2 dark:border-neutral-800"
        >
          {FILTER_TABS.map((tab) => {
            const active = filter === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter(tab.id)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  active
                    ? 'bg-indigo-600 text-white dark:bg-indigo-500'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700'
                }`}
              >
                {tab.label}
              </button>
            )
          })}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {loading && !items.length ? (
            <p className="px-2 py-6 text-center text-sm text-slate-500 dark:text-neutral-400">Loading…</p>
          ) : null}
          {error ? (
            <p className="px-2 py-4 text-center text-sm text-rose-600 dark:text-rose-400" role="alert">
              {error}
            </p>
          ) : null}
          {!loading && !error && filtered.length === 0 ? (
            <p className="px-2 py-8 text-center text-sm text-slate-500 dark:text-neutral-400">
              Nothing to show for this filter.
            </p>
          ) : null}
          <ul className="flex flex-col gap-1 pb-[env(safe-area-inset-bottom)]">
            {filtered.map((row) => {
              const Icon = kindIcon(row.kind)
              return (
                <li key={row.id}>
                  <Link
                    to={row.href}
                    onClick={onClose}
                    className="flex gap-3 rounded-xl px-2 py-2.5 text-left transition hover:bg-slate-50 dark:hover:bg-neutral-800"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600 dark:bg-neutral-800 dark:text-neutral-300">
                      <Icon className="h-5 w-5" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-sm font-medium text-slate-900 dark:text-neutral-100">
                        {row.title}
                      </span>
                      <span className="mt-0.5 line-clamp-2 text-xs text-slate-500 dark:text-neutral-400">
                        {row.subtitle}
                      </span>
                      <span className="mt-1 text-[11px] text-slate-400 dark:text-neutral-500">
                        {formatTimeAgoFromIso(row.sortAt)}
                      </span>
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>

        {loading && items.length > 0 ? (
          <div
            className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-slate-900/80 px-3 py-1 text-xs font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
            role="status"
          >
            Updating…
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}
