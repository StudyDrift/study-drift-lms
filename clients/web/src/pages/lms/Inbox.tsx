import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Archive,
  ChevronLeft,
  FileText,
  Inbox as InboxIcon,
  Mail,
  Paperclip,
  Search,
  Send,
  Star,
  Trash2,
} from 'lucide-react'
import { useMailboxRevision, useRefreshUnread } from '../../context/useInboxUnread'
import {
  fetchMailboxMessages,
  patchMailbox,
  sendMessage,
  type MailboxFolder,
  type MailboxMessage,
} from '../../lib/communicationApi'

function formatListDate(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfMsg = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diffDays = Math.floor(
    (startOfToday.getTime() - startOfMsg.getTime()) / (24 * 60 * 60 * 1000),
  )
  if (diffDays === 0) {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(d)
  }
  if (diffDays < 7) {
    return new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(d)
  }
  if (d.getFullYear() === now.getFullYear()) {
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(d)
  }
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(d)
}

function formatDetailDate(iso: string) {
  const d = new Date(iso)
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d)
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  }
  return name.slice(0, 2).toUpperCase()
}

const FOLDERS: { id: MailboxFolder; label: string; icon: typeof InboxIcon }[] = [
  { id: 'inbox', label: 'Inbox', icon: InboxIcon },
  { id: 'starred', label: 'Starred', icon: Star },
  { id: 'sent', label: 'Sent', icon: Send },
  { id: 'drafts', label: 'Drafts', icon: FileText },
  { id: 'trash', label: 'Trash', icon: Trash2 },
]

export default function Inbox() {
  const mailboxRevision = useMailboxRevision()
  const refreshUnread = useRefreshUnread()

  const [messages, setMessages] = useState<MailboxMessage[]>([])
  const [folder, setFolder] = useState<MailboxFolder>('inbox')
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [loadStatus, setLoadStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [loadError, setLoadError] = useState<string | null>(null)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mobilePane, setMobilePane] = useState<'list' | 'message'>('list')
  const [composeOpen, setComposeOpen] = useState(false)
  const [composeTo, setComposeTo] = useState('')
  const [composeSubject, setComposeSubject] = useState('')
  const [composeBody, setComposeBody] = useState('')
  const [composeBusy, setComposeBusy] = useState(false)
  const [composeError, setComposeError] = useState<string | null>(null)

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQuery(query), 300)
    return () => window.clearTimeout(t)
  }, [query])

  const loadMessages = useCallback(async () => {
    setLoadError(null)
    setLoadStatus('loading')
    try {
      const list = await fetchMailboxMessages(folder, debouncedQuery)
      setMessages(list)
      setLoadStatus('idle')
    } catch {
      setLoadError('Could not load messages. Is the API running?')
      setLoadStatus('error')
    }
  }, [folder, debouncedQuery])

  useEffect(() => {
    void loadMessages()
  }, [loadMessages, mailboxRevision])

  useEffect(() => {
    if (!composeOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (composeBusy) return
      e.preventDefault()
      setComposeOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [composeOpen, composeBusy])

  const selected = useMemo(
    () => messages.find((m) => m.id === selectedId) ?? null,
    [messages, selectedId],
  )

  const selectMessage = useCallback(
    async (id: string) => {
      setSelectedId(id)
      setMobilePane('message')
      const m = messages.find((x) => x.id === id)
      if (m?.folder === 'inbox' && !m.read) {
        try {
          await patchMailbox(id, { read: true })
          await loadMessages()
          await refreshUnread()
        } catch {
          /* ignore */
        }
      }
    },
    [messages, loadMessages, refreshUnread],
  )

  const toggleStar = useCallback(
    async (id: string, e?: React.MouseEvent) => {
      e?.stopPropagation()
      const m = messages.find((x) => x.id === id)
      if (!m) return
      try {
        await patchMailbox(id, { starred: !m.starred })
        await loadMessages()
        await refreshUnread()
      } catch {
        /* ignore */
      }
    },
    [messages, loadMessages, refreshUnread],
  )

  const moveToTrash = useCallback(
    async (id: string) => {
      try {
        await patchMailbox(id, { folder: 'trash' })
        setSelectedId((cur) => (cur === id ? null : cur))
        setMobilePane('list')
        await loadMessages()
        await refreshUnread()
      } catch {
        /* ignore */
      }
    },
    [loadMessages, refreshUnread],
  )

  const archiveFromInbox = useCallback(
    async (id: string) => {
      await moveToTrash(id)
    },
    [moveToTrash],
  )

  const sendCompose = useCallback(async () => {
    const to = composeTo.trim()
    const subject = composeSubject.trim() || '(no subject)'
    const body = composeBody.trim()
    if (!to) {
      setComposeError('Enter a recipient email.')
      return
    }
    setComposeError(null)
    setComposeBusy(true)
    try {
      const id = await sendMessage({ to_email: to, subject, body, draft: false })
      setComposeOpen(false)
      setComposeTo('')
      setComposeSubject('')
      setComposeBody('')
      setFolder('inbox')
      setSelectedId(id)
      setMobilePane('message')
      await loadMessages()
      await refreshUnread()
    } catch {
      setComposeError('Could not send. Check the address and try again.')
    } finally {
      setComposeBusy(false)
    }
  }, [composeBody, composeSubject, composeTo, loadMessages, refreshUnread])

  return (
    <>
      <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col overflow-hidden bg-white">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50/80 px-3 py-2.5 sm:px-4">
          <button
            type="button"
            onClick={() => {
              setComposeOpen(true)
              setComposeError(null)
            }}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
          >
            <Mail className="h-4 w-4 shrink-0" aria-hidden />
            Compose
          </button>
          <div className="relative min-w-[12rem] flex-1 sm:max-w-md">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search mail"
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 outline-none placeholder:text-slate-500 focus:border-indigo-300 focus:ring-2 focus:ring-indigo-500/20"
              aria-label="Search mail"
            />
          </div>
        </div>

        {loadError && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
            {loadError}
          </div>
        )}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
          <nav
            className="flex shrink-0 gap-1 border-b border-slate-200 p-2 md:w-52 md:flex-col md:border-b-0 md:border-r md:p-2"
            aria-label="Mail folders"
          >
            {FOLDERS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setFolder(id)
                  setSelectedId(null)
                  setMobilePane('list')
                }}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium transition md:w-full ${
                  folder === id
                    ? 'bg-indigo-50 text-indigo-800'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0 opacity-90" aria-hidden />
                {label}
              </button>
            ))}
          </nav>

          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col border-slate-200 md:flex-row md:border-l">
            <div
              className={`flex min-h-0 w-full shrink-0 flex-col border-slate-200 md:w-[min(100%,24rem)] md:border-r ${
                mobilePane === 'list' ? 'flex' : 'hidden'
              } md:flex`}
            >
              <div className="border-b border-slate-100 px-3 py-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                {loadStatus === 'loading' ? 'Loading…' : `${messages.length} conversation${messages.length === 1 ? '' : 's'}`}
              </div>
              <ul className="min-h-0 flex-1 overflow-y-auto" role="listbox" aria-label="Messages">
                {loadStatus === 'error' ? (
                  <li className="px-4 py-12 text-center text-sm text-slate-500">Could not load.</li>
                ) : messages.length === 0 ? (
                  <li className="px-4 py-12 text-center text-sm text-slate-500">
                    No messages in this view.
                  </li>
                ) : (
                  messages.map((m) => {
                    const active = m.id === selectedId
                    return (
                      <li
                        key={m.id}
                        className={`flex border-b border-slate-100 transition hover:bg-slate-50 ${
                          active ? 'bg-indigo-50/60' : ''
                        } ${!m.read ? 'bg-slate-50/90' : ''}`}
                      >
                        <button
                          type="button"
                          role="option"
                          aria-selected={active}
                          onClick={() => void selectMessage(m.id)}
                          className="flex min-w-0 flex-1 gap-3 px-3 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500/30"
                        >
                          <span
                            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-800"
                            aria-hidden
                          >
                            {initials(m.from.name)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-start justify-between gap-2">
                              <span
                                className={`truncate text-sm ${!m.read ? 'font-semibold text-slate-900' : 'text-slate-800'}`}
                              >
                                {m.folder === 'sent' || m.folder === 'drafts'
                                  ? `To: ${m.to}`
                                  : m.from.name}
                              </span>
                              <span className="shrink-0 text-xs text-slate-500">
                                {formatListDate(m.sent_at)}
                              </span>
                            </span>
                            <span
                              className={`mt-0.5 line-clamp-1 text-sm ${!m.read ? 'font-medium text-slate-900' : 'text-slate-700'}`}
                            >
                              {m.subject || '(no subject)'}
                            </span>
                            <span className="mt-0.5 line-clamp-1 text-xs text-slate-500">
                              {m.snippet || m.body.slice(0, 100)}
                              {m.body.length > 100 && !m.snippet ? '…' : ''}
                            </span>
                          </span>
                        </button>
                        <div className="flex shrink-0 flex-col items-end gap-1 px-2 py-3">
                          <button
                            type="button"
                            onClick={(e) => void toggleStar(m.id, e)}
                            className="rounded p-0.5 text-slate-400 hover:bg-slate-200/80 hover:text-amber-500"
                            aria-label={m.starred ? 'Remove star' : 'Star'}
                          >
                            <Star
                              className={`h-4 w-4 ${m.starred ? 'fill-amber-400 text-amber-500' : ''}`}
                              aria-hidden
                            />
                          </button>
                          {m.has_attachment && (
                            <Paperclip className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                          )}
                        </div>
                      </li>
                    )
                  })
                )}
              </ul>
            </div>

            <section
              className={`min-h-0 min-w-0 flex-1 flex-col bg-white ${
                mobilePane === 'message' ? 'flex' : 'hidden'
              } md:flex`}
              aria-label="Message"
            >
              {selected ? (
                <>
                  <div className="flex items-center gap-2 border-b border-slate-100 px-2 py-2 md:px-4">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-100 md:hidden"
                      onClick={() => {
                        setMobilePane('list')
                      }}
                    >
                      <ChevronLeft className="h-4 w-4" aria-hidden />
                      Back
                    </button>
                    <div className="ml-auto flex items-center gap-1">
                      {selected.folder === 'inbox' && (
                        <button
                          type="button"
                          onClick={() => void archiveFromInbox(selected.id)}
                          className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
                          title="Archive"
                        >
                          <Archive className="h-4 w-4" aria-hidden />
                          <span className="hidden sm:inline">Archive</span>
                        </button>
                      )}
                      {selected.folder !== 'trash' && (
                        <button
                          type="button"
                          onClick={() => void moveToTrash(selected.id)}
                          className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
                          title="Trash"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                          <span className="hidden sm:inline">Trash</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void toggleStar(selected.id)}
                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
                        aria-label={selected.starred ? 'Remove star' : 'Star'}
                      >
                        <Star
                          className={`h-4 w-4 ${selected.starred ? 'fill-amber-400 text-amber-500' : ''}`}
                          aria-hidden
                        />
                      </button>
                    </div>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6">
                    <h2 className="text-lg font-semibold leading-snug text-slate-900">
                      {selected.subject || '(no subject)'}
                    </h2>
                    <div className="mt-4 flex flex-wrap items-start gap-3 border-b border-slate-100 pb-4">
                      <span
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-semibold text-indigo-800"
                        aria-hidden
                      >
                        {initials(selected.from.name)}
                      </span>
                      <div className="min-w-0 flex-1 text-sm">
                        <div className="font-medium text-slate-900">{selected.from.name}</div>
                        <div className="text-slate-500">&lt;{selected.from.email}&gt;</div>
                        <div className="mt-1 text-xs text-slate-500">
                          To: {selected.to} · {formatDetailDate(selected.sent_at)}
                        </div>
                      </div>
                      {selected.has_attachment && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600">
                          <Paperclip className="h-3.5 w-3.5" aria-hidden />
                          Attachment
                        </span>
                      )}
                    </div>
                    <div className="mt-4 max-w-none whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
                      {selected.body || (
                        <span className="text-slate-400">Empty message.</span>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-16 text-center text-slate-500">
                  <Mail className="h-10 w-10 text-slate-300" aria-hidden />
                  <p className="text-sm font-medium text-slate-600">Select a message to read</p>
                  <p className="max-w-xs text-xs text-slate-500">
                    New mail appears in real time when the server notifies this session.
                  </p>
                </div>
              )}
            </section>
          </div>
        </div>
      </div>

      {composeOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="compose-title"
        >
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h3 id="compose-title" className="text-sm font-semibold text-slate-900">
                New message
              </h3>
              <button
                type="button"
                onClick={() => setComposeOpen(false)}
                className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              >
                Close
              </button>
            </div>
            <div className="space-y-3 px-4 py-4">
              {composeError && (
                <p className="text-sm text-red-600" role="alert">
                  {composeError}
                </p>
              )}
              <label className="block text-xs font-medium text-slate-600">
                To
                <input
                  value={composeTo}
                  onChange={(e) => setComposeTo(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-500/20"
                  placeholder="name@school.edu"
                />
              </label>
              <label className="block text-xs font-medium text-slate-600">
                Subject
                <input
                  value={composeSubject}
                  onChange={(e) => setComposeSubject(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-500/20"
                  placeholder="Subject"
                />
              </label>
              <label className="block text-xs font-medium text-slate-600">
                Message
                <textarea
                  value={composeBody}
                  onChange={(e) => setComposeBody(e.target.value)}
                  rows={6}
                  className="mt-1 w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-500/20"
                  placeholder="Write something…"
                />
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3">
              <button
                type="button"
                onClick={() => setComposeOpen(false)}
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={composeBusy}
                onClick={() => void sendCompose()}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-60"
              >
                <Send className="h-4 w-4" aria-hidden />
                Send
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
