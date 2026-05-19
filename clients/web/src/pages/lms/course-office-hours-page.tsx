import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { useViewerEnrollmentRoles } from '../../lib/use-viewer-enrollment-roles'
import {
  type AppointmentSlot,
  type AvailabilityWindow,
  type CreateWindowInput,
  DAY_NAMES,
  bookSlot,
  cancelBooking,
  createAvailabilityWindow,
  formatSlotTime,
  getSlotIcalUrl,
  listAvailability,
} from '../../lib/office-hours-api'
import { LmsPage } from './lms-page'

function slotStatusBadge(status: AppointmentSlot['status']) {
  switch (status) {
    case 'available':
      return (
        <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
          Available
        </span>
      )
    case 'booked':
      return (
        <span className="inline-flex rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-800 dark:bg-sky-900/40 dark:text-sky-300">
          Booked
        </span>
      )
    case 'completed':
      return (
        <span className="inline-flex rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
          Completed
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

interface SlotCardProps {
  slot: AppointmentSlot
  window: AvailabilityWindow | undefined
  isStaff: boolean
  myUserId: string | null
  onBook: (slot: AppointmentSlot) => void
  onCancel: (slot: AppointmentSlot) => void
}

function SlotCard({ slot, window: win, isStaff, myUserId, onBook, onCancel }: SlotCardProps) {
  const isMyBooking = slot.studentId != null && slot.studentId === myUserId
  const location = win?.location
  const isVirtual = win?.isVirtual

  return (
    <div
      role="gridcell"
      className={`rounded-xl border p-4 transition ${
        isMyBooking
          ? 'border-sky-300 bg-sky-50/60 dark:border-sky-700 dark:bg-sky-950/30'
          : slot.status === 'available'
            ? 'border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-800/50'
            : 'border-neutral-200 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900/30'
      }`}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <time
              dateTime={slot.slotStart}
              className="text-sm font-semibold text-neutral-900 dark:text-neutral-100"
              aria-label={formatSlotTime(slot)}
            >
              {formatSlotTime(slot)}
            </time>
            {slotStatusBadge(isMyBooking ? 'booked' : slot.status)}
          </div>
          {location && (
            <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
              {isVirtual ? '🖥 ' : '📍 '}
              {location}
            </p>
          )}
          {isStaff && slot.status === 'booked' && slot.studentNote && (
            <p className="mt-1 text-xs italic text-neutral-500 dark:text-neutral-400">
              Note: {slot.studentNote}
            </p>
          )}
          {isMyBooking && slot.studentNote && (
            <p className="mt-1 text-xs italic text-neutral-500 dark:text-neutral-400">
              Your note: {slot.studentNote}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {slot.status === 'available' && !isStaff && (
            <button
              type="button"
              onClick={() => onBook(slot)}
              aria-label={`Book appointment slot: ${formatSlotTime(slot)}`}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:bg-emerald-500 dark:hover:bg-emerald-600"
            >
              Book
            </button>
          )}
          {isMyBooking && (
            <>
              <a
                href={getSlotIcalUrl(slot.id)}
                aria-label="Add appointment to calendar"
                className="rounded-lg px-2 py-1.5 text-xs text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
              >
                📅
              </a>
              <button
                type="button"
                onClick={() => onCancel(slot)}
                aria-label="Cancel this appointment"
                className="rounded-lg px-2 py-1.5 text-xs text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30"
              >
                Cancel
              </button>
            </>
          )}
          {isStaff && slot.status !== 'cancelled' && (
            <a
              href={getSlotIcalUrl(slot.id)}
              aria-label="Download iCal for this appointment"
              className="rounded-lg px-2 py-1.5 text-xs text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
            >
              📅
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

interface BookingModalProps {
  slot: AppointmentSlot
  onClose: () => void
  onBooked: (slot: AppointmentSlot) => void
}

function BookingModal({ slot, onClose, onBooked }: BookingModalProps) {
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const noteRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    noteRef.current?.focus()
  }, [])

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      setSaving(true)
      setError(null)
      try {
        const booked = await bookSlot(slot.id, { note: note.trim() || null })
        onBooked(booked)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to book slot.')
        setSaving(false)
      }
    },
    [slot.id, note, onBooked],
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Book office hours appointment"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-neutral-900">
        <h2 className="mb-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          Book Appointment
        </h2>
        <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
          {formatSlotTime(slot)}
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="booking-note"
              className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
            >
              Note for instructor{' '}
              <span className="font-normal text-neutral-400">(optional)</span>
            </label>
            <textarea
              id="booking-note"
              ref={noteRef}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="e.g. I have a question about Assignment 2…"
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
            />
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
              {saving ? 'Booking…' : 'Confirm booking'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

interface CreateWindowModalProps {
  courseCode: string
  onClose: () => void
  onCreated: (window: AvailabilityWindow, slots: AppointmentSlot[]) => void
}

function CreateWindowModal({ courseCode, onClose, onCreated }: CreateWindowModalProps) {
  const [mode, setMode] = useState<'recurring' | 'oneoff'>('recurring')
  const [dayOfWeek, setDayOfWeek] = useState(1)
  const [windowDate, setWindowDate] = useState('')
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('11:00')
  const [slotDuration, setSlotDuration] = useState(15)
  const [location, setLocation] = useState('')
  const [isVirtual, setIsVirtual] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      setSaving(true)
      setError(null)
      const input: CreateWindowInput = {
        startTime,
        endTime,
        slotDurationMinutes: slotDuration,
        location: location.trim() || null,
        isVirtual,
      }
      if (mode === 'recurring') {
        input.dayOfWeek = dayOfWeek
      } else {
        input.windowDate = windowDate
      }
      try {
        const { window, slots } = await createAvailabilityWindow(courseCode, input)
        onCreated(window, slots)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create availability window.')
        setSaving(false)
      }
    },
    [courseCode, mode, dayOfWeek, windowDate, startTime, endTime, slotDuration, location, isVirtual, onCreated],
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Set up office hours availability"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl dark:bg-neutral-900">
        <h2 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          Add Office Hours Window
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMode('recurring')}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                mode === 'recurring'
                  ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                  : 'border-neutral-300 text-neutral-600 hover:border-neutral-400 dark:border-neutral-600 dark:text-neutral-300'
              }`}
            >
              Recurring (weekly)
            </button>
            <button
              type="button"
              onClick={() => setMode('oneoff')}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                mode === 'oneoff'
                  ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                  : 'border-neutral-300 text-neutral-600 hover:border-neutral-400 dark:border-neutral-600 dark:text-neutral-300'
              }`}
            >
              One-off date
            </button>
          </div>

          {mode === 'recurring' ? (
            <div>
              <label className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                Day of week
              </label>
              <select
                value={dayOfWeek}
                onChange={(e) => setDayOfWeek(Number(e.target.value))}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
              >
                {DAY_NAMES.map((name, i) => (
                  <option key={name} value={i}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                Date
              </label>
              <input
                type="date"
                value={windowDate}
                onChange={(e) => setWindowDate(e.target.value)}
                required
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                Start time
              </label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                required
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                End time
              </label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                required
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Slot duration (minutes)
            </label>
            <select
              value={slotDuration}
              onChange={(e) => setSlotDuration(Number(e.target.value))}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
            >
              <option value={10}>10 minutes</option>
              <option value={15}>15 minutes</option>
              <option value={20}>20 minutes</option>
              <option value={30}>30 minutes</option>
              <option value={45}>45 minutes</option>
              <option value={60}>60 minutes</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Location / URL{' '}
              <span className="font-normal text-neutral-400">(optional)</span>
            </label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. Room 204 or https://meet.example.com/…"
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              role="switch"
              aria-checked={isVirtual}
              onClick={() => setIsVirtual((v) => !v)}
              className={`relative inline-flex h-6 w-10 shrink-0 rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                isVirtual ? 'bg-emerald-600' : 'bg-neutral-300 dark:bg-neutral-600'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition ${
                  isVirtual ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
            <span className="text-sm text-neutral-700 dark:text-neutral-300">Virtual office hours</span>
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
              {saving ? 'Saving…' : 'Add window'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function CourseOfficeHoursPage() {
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

  const [windows, setWindows] = useState<AvailabilityWindow[]>([])
  const [slots, setSlots] = useState<AppointmentSlot[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [bookingSlot, setBookingSlot] = useState<AppointmentSlot | null>(null)

  const load = useCallback(async () => {
    if (!courseCode) return
    setError(null)
    try {
      const data = await listAvailability(courseCode)
      setWindows(data.windows)
      setSlots(data.slots)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load office hours.')
    } finally {
      setLoading(false)
    }
  }, [courseCode])

  useEffect(() => {
    void load()
  }, [load])

  const windowMap = useMemo(() => {
    const m = new Map<string, AvailabilityWindow>()
    for (const w of windows) m.set(w.id, w)
    return m
  }, [windows])

  const handleCreated = useCallback((w: AvailabilityWindow, newSlots: AppointmentSlot[]) => {
    setWindows((prev) => [...prev, w])
    setSlots((prev) => [...prev, ...newSlots])
    setCreateOpen(false)
  }, [])

  const handleBooked = useCallback((booked: AppointmentSlot) => {
    setSlots((prev) => prev.map((s) => (s.id === booked.id ? booked : s)))
    setBookingSlot(null)
  }, [])

  const handleCancel = useCallback(async (slot: AppointmentSlot) => {
    if (!window.confirm('Cancel your appointment?')) return
    try {
      const updated = await cancelBooking(slot.id)
      setSlots((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to cancel.')
    }
  }, [])

  if (!courseCode) return <Navigate to="/courses" replace />

  const availableSlots = slots.filter((s) => s.status === 'available')
  const bookedSlots = slots.filter((s) => s.status === 'booked')

  return (
    <LmsPage title="Office Hours" description="Book a 1-on-1 appointment with your instructor.">
      {/* Header */}
      <div className="mb-4 flex items-center justify-end">
        {!rolesLoading && isStaff && (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-600"
          >
            + Add availability
          </button>
        )}
      </div>

      {loading && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800"
            />
          ))}
        </div>
      )}

      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-300">
          {error}
        </p>
      )}

      {!loading && !error && slots.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-neutral-300 py-12 text-center dark:border-neutral-700">
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            No office hours available yet.
          </p>
          {!rolesLoading && isStaff && (
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="mt-2 text-sm font-medium text-emerald-600 hover:underline dark:text-emerald-400"
            >
              Add your first availability window.
            </button>
          )}
        </div>
      )}

      {!loading && !error && slots.length > 0 && (
        <div className="space-y-6" role="grid" aria-label="Office hours appointment slots">
          {availableSlots.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                Available
              </h3>
              <div className="space-y-2">
                {availableSlots.map((s) => (
                  <SlotCard
                    key={s.id}
                    slot={s}
                    window={windowMap.get(s.windowId)}
                    isStaff={isStaff}
                    myUserId={null}
                    onBook={setBookingSlot}
                    onCancel={handleCancel}
                  />
                ))}
              </div>
            </section>
          )}
          {bookedSlots.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-sky-600 dark:text-sky-400">
                Booked
              </h3>
              <div className="space-y-2">
                {bookedSlots.map((s) => (
                  <SlotCard
                    key={s.id}
                    slot={s}
                    window={windowMap.get(s.windowId)}
                    isStaff={isStaff}
                    myUserId={s.studentId ?? null}
                    onBook={setBookingSlot}
                    onCancel={handleCancel}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {createOpen && courseCode && (
        <CreateWindowModal
          courseCode={courseCode}
          onClose={() => setCreateOpen(false)}
          onCreated={handleCreated}
        />
      )}
      {bookingSlot && (
        <BookingModal
          slot={bookingSlot}
          onClose={() => setBookingSlot(null)}
          onBooked={handleBooked}
        />
      )}
    </LmsPage>
  )
}
