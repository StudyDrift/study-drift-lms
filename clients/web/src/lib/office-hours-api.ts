import { authorizedFetch } from './api'
import { readApiErrorMessage } from './errors'

export type SlotStatus = 'available' | 'booked' | 'cancelled' | 'completed'

export type AvailabilityWindow = {
  id: string
  instructorId: string
  courseId?: string | null
  dayOfWeek?: number | null
  windowDate?: string | null
  startTime: string
  endTime: string
  slotDurationMinutes: number
  location?: string | null
  isVirtual: boolean
  status: string
  createdAt: string
}

export type AppointmentSlot = {
  id: string
  windowId: string
  slotStart: string
  slotEnd: string
  studentId?: string | null
  studentNote?: string | null
  meetingId?: string | null
  status: SlotStatus
  bookedAt?: string | null
}

export type CreateWindowInput = {
  dayOfWeek?: number | null
  windowDate?: string | null
  startTime: string
  endTime: string
  slotDurationMinutes?: number
  location?: string | null
  isVirtual?: boolean
}

export type BookSlotInput = {
  note?: string | null
}

export type AvailabilityResponse = {
  windows: AvailabilityWindow[]
  slots: AppointmentSlot[]
}

export async function listAvailability(courseCode: string): Promise<AvailabilityResponse> {
  const res = await authorizedFetch(`/api/v1/courses/${encodeURIComponent(courseCode)}/availability`)
  const raw = await res.json() as { windows?: AvailabilityWindow[]; slots?: AppointmentSlot[] }
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return {
    windows: raw.windows ?? [],
    slots: raw.slots ?? [],
  }
}

export async function createAvailabilityWindow(
  courseCode: string,
  input: CreateWindowInput,
): Promise<{ window: AvailabilityWindow; slots: AppointmentSlot[] }> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/availability`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
  const raw = await res.json() as { window?: AvailabilityWindow; slots?: AppointmentSlot[] }
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return { window: raw.window!, slots: raw.slots ?? [] }
}

export async function bookSlot(slotId: string, input: BookSlotInput = {}): Promise<AppointmentSlot> {
  const res = await authorizedFetch(`/api/v1/slots/${encodeURIComponent(slotId)}/book`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const raw = await res.json() as AppointmentSlot
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw
}

export async function cancelBooking(slotId: string): Promise<AppointmentSlot> {
  const res = await authorizedFetch(`/api/v1/slots/${encodeURIComponent(slotId)}/book`, {
    method: 'DELETE',
  })
  const raw = await res.json() as AppointmentSlot
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw
}

export async function listMyAppointments(): Promise<AppointmentSlot[]> {
  const res = await authorizedFetch('/api/v1/me/appointments')
  const raw = await res.json() as { appointments?: AppointmentSlot[] }
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw.appointments ?? []
}

export function getSlotIcalUrl(slotId: string): string {
  return `/api/v1/slots/${encodeURIComponent(slotId)}/ical`
}

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const

export function formatSlotTime(slot: AppointmentSlot): string {
  const start = new Date(slot.slotStart)
  const end = new Date(slot.slotEnd)
  const opts: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }
  return (
    start.toLocaleString(undefined, opts) +
    ' – ' +
    end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  )
}
