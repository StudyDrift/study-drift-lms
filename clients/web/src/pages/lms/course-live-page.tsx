import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { useViewerEnrollmentRoles } from '../../lib/use-viewer-enrollment-roles'
import {
  type CreateMeetingInput,
  type MeetingProvider,
  type MeetingStatus,
  type VirtualMeeting,
  createMeeting,
  formatMeetingTime,
  getMeetingIcalUrl,
  getMeetingJoinInfo,
  isMeetingLiveOrSoon,
  listMeetings,
  patchMeeting,
} from '../../lib/virtual-meetings-api'
import { LmsPage } from './lms-page'

function statusBadge(status: MeetingStatus) {
  switch (status) {
    case 'live':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
          Live
        </span>
      )
    case 'scheduled':
      return (
        <span className="inline-flex rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-800 dark:bg-sky-900/40 dark:text-sky-300">
          Scheduled
        </span>
      )
    case 'ended':
      return (
        <span className="inline-flex rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
          Ended
        </span>
      )
    case 'cancelled':
      return (
        <span className="inline-flex rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
          Cancelled
        </span>
      )
  }
}

function MeetingCountdown({ scheduledStart }: { scheduledStart: string }) {
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    const tick = () => {
      const diff = Math.max(0, Math.floor((new Date(scheduledStart).getTime() - Date.now()) / 1000))
      setSeconds(diff)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [scheduledStart])

  if (seconds <= 0) return null
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return (
    <span
      role="timer"
      aria-live="polite"
      className="text-xs text-amber-700 dark:text-amber-400"
    >
      Starting in {m}m {String(s).padStart(2, '0')}s
    </span>
  )
}

interface MeetingCardProps {
  meeting: VirtualMeeting
  isStaff: boolean
  onJoin: (meeting: VirtualMeeting) => void
  onCancel: (meeting: VirtualMeeting) => void
}

function MeetingCard({ meeting, isStaff, onJoin, onCancel }: MeetingCardProps) {
  const isActive = meeting.status === 'live'
  const isComingSoon = isMeetingLiveOrSoon(meeting) && meeting.status === 'scheduled'

  return (
    <div
      className={`rounded-xl border p-4 transition ${
        isActive
          ? 'border-emerald-300 bg-emerald-50/60 dark:border-emerald-700 dark:bg-emerald-950/30'
          : 'border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-800/50'
      }`}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              {meeting.title}
            </h3>
            {statusBadge(meeting.status)}
            {isComingSoon && meeting.scheduledStart && (
              <MeetingCountdown scheduledStart={meeting.scheduledStart} />
            )}
          </div>
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            {formatMeetingTime(meeting)}
          </p>
          <p className="mt-0.5 text-xs text-neutral-400 dark:text-neutral-500 capitalize">
            {meeting.provider}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {meeting.status !== 'cancelled' && meeting.status !== 'ended' && (
            <button
              type="button"
              onClick={() => onJoin(meeting)}
              aria-label={`Join live session: ${meeting.title}`}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                isActive || isComingSoon
                  ? 'bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-600'
                  : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200 dark:bg-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-600'
              }`}
            >
              {isActive ? 'Join Now' : 'Join'}
            </button>
          )}
          <a
            href={getMeetingIcalUrl(meeting.id)}
            aria-label={`Add ${meeting.title} to calendar`}
            className="rounded-lg px-2 py-1.5 text-xs text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
          >
            📅
          </a>
          {isStaff && meeting.status !== 'cancelled' && meeting.status !== 'ended' && (
            <button
              type="button"
              onClick={() => onCancel(meeting)}
              className="rounded-lg px-2 py-1.5 text-xs text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

interface CreateMeetingModalProps {
  onClose: () => void
  onCreated: (meeting: VirtualMeeting) => void
  courseCode: string
}

function CreateMeetingModal({ onClose, onCreated, courseCode }: CreateMeetingModalProps) {
  const [title, setTitle] = useState('')
  const [provider, setProvider] = useState<MeetingProvider>('jitsi')
  const [scheduledStart, setScheduledStart] = useState('')
  const [scheduledEnd, setScheduledEnd] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    titleRef.current?.focus()
  }, [])

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      setSaving(true)
      setError(null)
      const input: CreateMeetingInput = {
        title: title.trim(),
        provider,
        scheduledStart: scheduledStart || null,
        scheduledEnd: scheduledEnd || null,
      }
      try {
        const m = await createMeeting(courseCode, input)
        onCreated(m)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create meeting.')
        setSaving(false)
      }
    },
    [courseCode, title, provider, scheduledStart, scheduledEnd, onCreated],
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Schedule live session"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-neutral-900">
        <h2 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          Schedule Live Session
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="meeting-title"
              className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
            >
              Title
            </label>
            <input
              id="meeting-title"
              ref={titleRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              placeholder="e.g. Monday Lecture"
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Provider
            </label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as MeetingProvider)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
            >
              <option value="jitsi">Jitsi Meet</option>
              <option value="bbb">BigBlueButton</option>
              <option value="zoom">Zoom</option>
              <option value="meet">Google Meet</option>
              <option value="custom">Custom URL</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                Start
              </label>
              <input
                type="datetime-local"
                value={scheduledStart}
                onChange={(e) => setScheduledStart(e.target.value)}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                End
              </label>
              <input
                type="datetime-local"
                value={scheduledEnd}
                onChange={(e) => setScheduledEnd(e.target.value)}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
              />
            </div>
          </div>
          {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60 dark:bg-emerald-500 dark:hover:bg-emerald-600"
            >
              {saving ? 'Scheduling…' : 'Schedule'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function CourseLivePage() {
  const { courseCode } = useParams<{ courseCode: string }>()
  const viewerRoles = useViewerEnrollmentRoles(courseCode)
  const rolesLoading = viewerRoles === null
  const isStaff = useMemo(
    () =>
      !rolesLoading &&
      Array.isArray(viewerRoles) &&
      viewerRoles.some((r) => ['teacher', 'instructor', 'ta'].includes(r.toLowerCase())),
    [viewerRoles, rolesLoading],
  )
  const [meetings, setMeetings] = useState<VirtualMeeting[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const load = useCallback(async () => {
    if (!courseCode) return
    setError(null)
    try {
      const data = await listMeetings(courseCode)
      setMeetings(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load live sessions.')
    } finally {
      setLoading(false)
    }
  }, [courseCode])

  useEffect(() => {
    void load()
  }, [load])

  const handleJoin = useCallback(async (meeting: VirtualMeeting) => {
    try {
      const info = await getMeetingJoinInfo(meeting.id)
      window.open(info.joinUrl, '_blank', 'noopener,noreferrer')
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not get join URL.')
    }
  }, [])

  const handleCancel = useCallback(async (meeting: VirtualMeeting) => {
    if (!window.confirm(`Cancel "${meeting.title}"?`)) return
    try {
      await patchMeeting(meeting.id, { status: 'cancelled' })
      setMeetings((prev) => prev.filter((m) => m.id !== meeting.id))
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to cancel meeting.')
    }
  }, [])

  const handleCreated = useCallback((m: VirtualMeeting) => {
    setMeetings((prev) => [m, ...prev])
    setCreateOpen(false)
  }, [])

  if (!courseCode) return <Navigate to="/courses" replace />

  const liveMeetings = meetings.filter((m) => m.status === 'live')
  const upcomingMeetings = meetings.filter((m) => m.status === 'scheduled')
  const pastMeetings = meetings.filter((m) => m.status === 'ended')

  return (
    <LmsPage title="Live Sessions" description="Virtual classroom sessions for this course.">
      {/* Live banner */}
      {liveMeetings.length > 0 && (
        <div className="mb-6 flex items-center justify-between rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 dark:border-emerald-700 dark:bg-emerald-950/30">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-500" />
            <span className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
              {liveMeetings.length > 1
                ? `${liveMeetings.length} sessions are live`
                : 'A live session is in progress'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => handleJoin(liveMeetings[0])}
            aria-label={`Join live session: ${liveMeetings[0].title}`}
            className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-600"
          >
            Join Now
          </button>
        </div>
      )}

      {/* Header */}
      <div className="mb-4 flex items-center justify-end">
        {!rolesLoading && isStaff && (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-600"
          >
            + Schedule Session
          </button>
        )}
      </div>

      {loading && (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="h-20 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800"
            />
          ))}
        </div>
      )}

      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-300">
          {error}
        </p>
      )}

      {!loading && !error && meetings.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-neutral-300 py-12 text-center dark:border-neutral-700">
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            No upcoming live sessions.
          </p>
          {!rolesLoading && isStaff && (
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="mt-2 text-sm font-medium text-emerald-600 hover:underline dark:text-emerald-400"
            >
              Schedule one from the Live Sessions tab.
            </button>
          )}
        </div>
      )}

      {!loading && !error && meetings.length > 0 && (
        <div className="space-y-6">
          {liveMeetings.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                Live Now
              </h3>
              <div className="space-y-2">
                {liveMeetings.map((m) => (
                  <MeetingCard
                    key={m.id}
                    meeting={m}
                    isStaff={isStaff}
                    onJoin={handleJoin}
                    onCancel={handleCancel}
                  />
                ))}
              </div>
            </section>
          )}
          {upcomingMeetings.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-sky-600 dark:text-sky-400">
                Upcoming
              </h3>
              <div className="space-y-2">
                {upcomingMeetings.map((m) => (
                  <MeetingCard
                    key={m.id}
                    meeting={m}
                    isStaff={isStaff}
                    onJoin={handleJoin}
                    onCancel={handleCancel}
                  />
                ))}
              </div>
            </section>
          )}
          {pastMeetings.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                Past Sessions
              </h3>
              <div className="space-y-2">
                {pastMeetings.map((m) => (
                  <MeetingCard
                    key={m.id}
                    meeting={m}
                    isStaff={isStaff}
                    onJoin={handleJoin}
                    onCancel={handleCancel}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {createOpen && courseCode && (
        <CreateMeetingModal
          courseCode={courseCode}
          onClose={() => setCreateOpen(false)}
          onCreated={handleCreated}
        />
      )}
    </LmsPage>
  )
}
