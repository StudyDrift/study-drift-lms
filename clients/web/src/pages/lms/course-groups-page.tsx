import { Hash, Plus, Users, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { EmptyState } from '../../components/ui/empty-state'
import { FeedComposer } from '../../components/feed/feed-composer'
import {
  createGroupChannel,
  fetchAllGroups,
  fetchGroupChannels,
  fetchGroupMessages,
  fetchMyGroups,
  postGroupMessage,
  type GroupChannel,
  type GroupMessage,
  type GroupPublic,
} from '../../lib/group-spaces-api'
import { fetchFeedRoster, type FeedRosterPerson } from '../../lib/course-feed-api'
import { getJwtSubject } from '../../lib/auth'
import { useCourseNavFeatures } from '../../context/course-nav-features-context'
import { formatRelativeCompact } from '../../lib/format-datetime'
import { LmsPage } from './lms-page'


function isCourseStaff(roles: string[] | undefined): boolean {
  return Boolean(roles?.some((r) => r === 'teacher' || r === 'instructor'))
}


function authorLabel(m: GroupMessage): string {
  return m.authorDisplayName?.trim() || m.authorEmail
}

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

function GroupAvatar({ userId, name }: { userId: string; name: string }) {
  const h = hueFromString(userId.toLowerCase())
  const h2 = (h + 48) % 360
  return (
    <div
      className="flex h-10 w-10 shrink-0 select-none items-center justify-center rounded-full text-sm font-semibold text-white shadow-sm ring-2 ring-white dark:ring-neutral-950"
      style={{ background: `linear-gradient(145deg, hsl(${h} 58% 48%), hsl(${h2} 52% 40%))` }}
      aria-hidden
    >
      {displayInitials(name)}
    </div>
  )
}

export default function CourseGroupsPage() {
  const { courseCode } = useParams<{ courseCode: string }>()
  const { groupSpacesEnabled, loading: featureFlagLoading } = useCourseNavFeatures()
  const viewerId = getJwtSubject()

  const [groups, setGroups] = useState<GroupPublic[]>([])
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null)
  const [channels, setChannels] = useState<GroupChannel[]>([])
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null)
  const [messages, setMessages] = useState<GroupMessage[]>([])
  const [roster, setRoster] = useState<FeedRosterPerson[]>([])
  const [composer, setComposer] = useState('')
  const [sending, setSending] = useState(false)
  const [newChannelName, setNewChannelName] = useState('')
  const [newChannelModalOpen, setNewChannelModalOpen] = useState(false)
  const [creatingChannel, setCreatingChannel] = useState(false)
  const [isInstructor, setIsInstructor] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const feedScrollRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = useCallback(() => {
    const el = feedScrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [])

  // Load groups and roster on mount.
  useEffect(() => {
    if (!courseCode) return
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const [myGroups, allGroups, r] = await Promise.all([
          fetchMyGroups(courseCode).catch(() => [] as GroupPublic[]),
          fetchAllGroups(courseCode).catch(() => [] as GroupPublic[]),
          fetchFeedRoster(courseCode).catch(() => [] as FeedRosterPerson[]),
        ])
        if (cancelled) return
        // Instructors see all groups; determine by whether all-groups list is accessible.
        const isStaff = allGroups.length > 0 || (myGroups.length === 0 && allGroups.length === 0)
        // More reliable: try all-groups (403 for non-instructors means we got an empty list
        // from the catch above). Use myGroups otherwise.
        const displayGroups = allGroups.length > 0 ? allGroups : myGroups
        setIsInstructor(allGroups.length > 0)
        setGroups(displayGroups)
        setRoster(r)
        if (displayGroups.length > 0 && !cancelled) {
          setActiveGroupId(displayGroups[0].id)
        }
        void isStaff // suppress lint
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load groups.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [courseCode])

  // Load channels when active group changes.
  useEffect(() => {
    if (!courseCode || !activeGroupId) {
      setChannels([])
      setActiveChannelId(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const ch = await fetchGroupChannels(courseCode, activeGroupId)
        if (!cancelled) {
          setChannels(ch)
          setActiveChannelId(ch[0]?.id ?? null)
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load channels.')
      }
    })()
    return () => { cancelled = true }
  }, [courseCode, activeGroupId])

  // Load messages when active channel changes.
  useEffect(() => {
    if (!courseCode || !activeGroupId || !activeChannelId) {
      setMessages([])
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const msgs = await fetchGroupMessages(courseCode, activeGroupId, activeChannelId)
        if (!cancelled) {
          setMessages(msgs)
          scrollToBottom()
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load messages.')
      }
    })()
    return () => { cancelled = true }
  }, [courseCode, activeGroupId, activeChannelId, scrollToBottom])

  const reloadMessages = useCallback(async () => {
    if (!courseCode || !activeGroupId || !activeChannelId) return
    try {
      const msgs = await fetchGroupMessages(courseCode, activeGroupId, activeChannelId)
      setMessages(msgs)
      scrollToBottom()
    } catch {
      // ignore reload errors silently
    }
  }, [courseCode, activeGroupId, activeChannelId, scrollToBottom])

  const sendMessage = async () => {
    if (!courseCode || !activeGroupId || !activeChannelId) return
    const text = composer.trim()
    if (!text) return
    setSending(true)
    setError(null)
    try {
      await postGroupMessage(courseCode, activeGroupId, activeChannelId, text)
      setComposer('')
      await reloadMessages()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send message.')
    } finally {
      setSending(false)
    }
  }

  const onCreateChannel = async () => {
    if (!courseCode || !activeGroupId) return
    const name = newChannelName.trim()
    if (!name) return
    setCreatingChannel(true)
    setError(null)
    try {
      const ch = await createGroupChannel(courseCode, activeGroupId, name)
      setNewChannelName('')
      setNewChannelModalOpen(false)
      const updated = await fetchGroupChannels(courseCode, activeGroupId)
      setChannels(updated)
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

  if (!courseCode) {
    return (
      <LmsPage title="Groups" description="">
        <p className="mt-6 text-sm text-slate-500">Invalid link.</p>
      </LmsPage>
    )
  }

  if (!featureFlagLoading && !groupSpacesEnabled) {
    return <Navigate to={`/courses/${encodeURIComponent(courseCode)}`} replace />
  }

  const activeGroup = groups.find((g) => g.id === activeGroupId) ?? null
  const activeChannel = channels.find((c) => c.id === activeChannelId) ?? null

  return (
    <LmsPage fillHeight omitHeader title={activeGroup ? `Groups — ${activeGroup.name}` : 'Groups'}>
      {error && (
        <p className="mb-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-100">
          {error}
        </p>
      )}

      {loading && (
        <p className="text-sm text-slate-500 dark:text-neutral-400">Loading groups…</p>
      )}

      {!loading && (
        <div className="flex min-h-0 flex-1 flex-col gap-3 md:flex-row md:items-stretch">
          {/* Groups sidebar */}
          <aside className="flex w-full shrink-0 flex-col rounded-xl border border-slate-200 bg-white p-2.5 dark:border-neutral-800 dark:bg-neutral-950 md:h-auto md:w-52">
            <p className="px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-neutral-400">
              Groups
            </p>
            {groups.length === 0 ? (
              <p className="px-1 text-xs text-slate-400 dark:text-neutral-500">No groups yet.</p>
            ) : (
              <div className="flex flex-col gap-0.5">
                {groups.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => setActiveGroupId(g.id)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm font-medium ${
                      g.id === activeGroupId
                        ? 'bg-indigo-50 text-indigo-900 dark:bg-indigo-950/50 dark:text-indigo-100'
                        : 'text-slate-700 hover:bg-slate-50 dark:text-neutral-200 dark:hover:bg-neutral-900'
                    }`}
                  >
                    <Users className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{g.name}</span>
                    {isInstructor && g.memberCount > 0 && (
                      <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[0.65rem] font-medium text-slate-500 dark:bg-neutral-800 dark:text-neutral-400">
                        {g.memberCount}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </aside>

          {/* Channel sidebar */}
          {activeGroupId && (
            <aside className="flex w-full shrink-0 flex-col rounded-xl border border-slate-200 bg-white p-2.5 dark:border-neutral-800 dark:bg-neutral-950 md:h-auto md:w-44">
              <div className="flex items-center justify-between gap-2 px-1 pb-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-neutral-400">
                  Channels
                </p>
                {isInstructor && (
                  <button
                    type="button"
                    onClick={() => { setNewChannelName(''); setNewChannelModalOpen(true) }}
                    className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                    aria-label="New channel"
                  >
                    <Plus className="h-4 w-4" aria-hidden />
                  </button>
                )}
              </div>
              <div className="flex flex-col gap-0.5">
                {channels.map((ch) => (
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
                  </button>
                ))}
              </div>
            </aside>
          )}

          {/* New channel modal */}
          {newChannelModalOpen && (
            <div
              className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center dark:bg-neutral-950"
              role="dialog"
              aria-modal="true"
              aria-labelledby="group-new-channel-title"
              onClick={(e) => { if (e.target === e.currentTarget && !creatingChannel) setNewChannelModalOpen(false) }}
            >
              <div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-950">
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-neutral-800">
                  <h3 id="group-new-channel-title" className="text-sm font-semibold text-slate-900 dark:text-neutral-100">
                    New channel
                  </h3>
                  <button
                    type="button"
                    onClick={() => !creatingChannel && setNewChannelModalOpen(false)}
                    disabled={creatingChannel}
                    className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-50 dark:text-neutral-400 dark:hover:bg-neutral-800"
                    aria-label="Close"
                  >
                    <X className="h-5 w-5" aria-hidden />
                  </button>
                </div>
                <div className="p-4">
                  <label className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-neutral-400" htmlFor="group-new-channel-name">
                    Channel name
                  </label>
                  <input
                    id="group-new-channel-name"
                    value={newChannelName}
                    onChange={(e) => setNewChannelName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !creatingChannel) { e.preventDefault(); void onCreateChannel() } }}
                    placeholder="e.g. project-chat"
                    autoFocus
                    disabled={creatingChannel}
                    maxLength={80}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/30 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                  />
                </div>
                <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/80 px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900">
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
                    className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50"
                  >
                    {creatingChannel ? 'Creating…' : 'Create'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Message area */}
          <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-950">
            {activeGroupId && activeChannelId ? (
              <>
                <div className="shrink-0 border-b border-slate-100 px-3 py-2 sm:px-4 dark:border-neutral-800">
                  <h2 className="flex min-w-0 items-baseline gap-1.5 truncate text-base font-semibold tracking-tight text-slate-900 dark:text-neutral-50">
                    <span className="shrink-0 text-slate-400 dark:text-neutral-500" aria-hidden>#</span>
                    <span className="min-w-0 truncate">{activeChannel?.name ?? 'Channel'}</span>
                    {activeGroup && (
                      <span className="ml-1 text-sm font-normal text-slate-400 dark:text-neutral-500">
                        — {activeGroup.name}
                      </span>
                    )}
                  </h2>
                </div>

                <div
                  ref={feedScrollRef}
                  className="min-h-0 flex-1 overflow-y-auto px-3 py-1 sm:px-4"
                >
                  {messages.length === 0 ? (
                    <EmptyState
                      icon={Hash}
                      title="No messages yet"
                      body="Start the conversation — your group members will see your messages here."
                      className="my-3"
                    />
                  ) : (
                    messages.map((m) => (
                      <article
                        key={m.id}
                        className="border-b border-slate-100 py-3.5 last:border-b-0 dark:border-neutral-800/80"
                      >
                        <div className="flex gap-3">
                          <GroupAvatar userId={m.authorUserId} name={authorLabel(m)} />
                          <div className="min-w-0 flex-1 pt-0.5">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              <span className="truncate text-[0.9375rem] font-semibold text-slate-900 dark:text-neutral-50">
                                {authorLabel(m)}
                              </span>
                              <span className="text-slate-300 dark:text-neutral-600" aria-hidden>·</span>
                              <time
                                className="shrink-0 text-xs font-medium text-slate-400 dark:text-neutral-500"
                                dateTime={m.createdAt}
                              >
                                {formatRelativeCompact(m.createdAt)}
                              </time>
                            </div>
                            <p className="mt-1.5 whitespace-pre-wrap text-[0.9375rem] leading-relaxed text-slate-800 dark:text-neutral-100">
                              {m.body}
                            </p>
                          </div>
                        </div>
                      </article>
                    ))
                  )}
                </div>

                <div className="shrink-0 border-t border-slate-200 px-3 py-2 sm:px-4 dark:border-neutral-800">
                  <FeedComposer
                    courseCode={courseCode}
                    value={composer}
                    onChange={setComposer}
                    roster={roster}
                    viewerUserId={viewerId}
                    staff={isInstructor}
                    placeholder="Message this group channel…"
                    disabled={sending}
                    onSubmit={() => void sendMessage()}
                  />
                </div>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center">
                <EmptyState
                  icon={Users}
                  title="Select a group"
                  body="Choose a group from the list on the left to see its channels and messages."
                />
              </div>
            )}
          </section>
        </div>
      )}
    </LmsPage>
  )
}
