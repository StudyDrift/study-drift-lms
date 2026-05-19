import { authorizedFetch } from './api'
import { readApiErrorMessage } from './errors'

export type MeetingStatus = 'scheduled' | 'live' | 'ended' | 'cancelled'
export type MeetingProvider = 'jitsi' | 'bbb' | 'zoom' | 'meet' | 'lti' | 'custom'

export type VirtualMeeting = {
  id: string
  courseId: string
  sectionId?: string | null
  provider: MeetingProvider
  title: string
  scheduledStart?: string | null
  scheduledEnd?: string | null
  joinUrl?: string | null
  hostUrl?: string | null
  externalMeetingId?: string | null
  status: MeetingStatus
  createdBy: string
  createdAt: string
}

export type CreateMeetingInput = {
  title: string
  provider?: MeetingProvider
  scheduledStart?: string | null
  scheduledEnd?: string | null
  sectionId?: string | null
}

export type PatchMeetingInput = {
  title?: string
  scheduledStart?: string | null
  scheduledEnd?: string | null
  joinUrl?: string | null
  hostUrl?: string | null
  status?: MeetingStatus
}

export type MeetingJoinInfo = {
  joinUrl: string
  hostUrl?: string
  meetingId: string
  status: MeetingStatus
}

export type AttendanceRecord = {
  id: string
  meetingId: string
  userId: string
  joinedAt: string
  leftAt?: string | null
  durationSeconds?: number | null
}

export async function listMeetings(courseCode: string): Promise<VirtualMeeting[]> {
  const res = await authorizedFetch(`/api/v1/courses/${encodeURIComponent(courseCode)}/meetings`)
  const raw = await res.json() as { meetings?: VirtualMeeting[] }
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw.meetings ?? []
}

export async function createMeeting(courseCode: string, input: CreateMeetingInput): Promise<VirtualMeeting> {
  const res = await authorizedFetch(`/api/v1/courses/${encodeURIComponent(courseCode)}/meetings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const raw = await res.json() as VirtualMeeting
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw
}

export async function patchMeeting(meetingId: string, input: PatchMeetingInput): Promise<VirtualMeeting> {
  const res = await authorizedFetch(`/api/v1/meetings/${encodeURIComponent(meetingId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const raw = await res.json() as VirtualMeeting
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw
}

export async function getMeetingJoinInfo(meetingId: string): Promise<MeetingJoinInfo> {
  const res = await authorizedFetch(`/api/v1/meetings/${encodeURIComponent(meetingId)}/join`)
  const raw = await res.json() as MeetingJoinInfo
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw
}

export async function getMeetingAttendance(meetingId: string): Promise<AttendanceRecord[]> {
  const res = await authorizedFetch(`/api/v1/meetings/${encodeURIComponent(meetingId)}/attendance`)
  const raw = await res.json() as { attendance?: AttendanceRecord[] }
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw.attendance ?? []
}

export function getMeetingIcalUrl(meetingId: string): string {
  return `/api/v1/meetings/${encodeURIComponent(meetingId)}/ical`
}

export function isMeetingLiveOrSoon(meeting: VirtualMeeting): boolean {
  if (meeting.status === 'live') return true
  if (!meeting.scheduledStart) return false
  const diff = new Date(meeting.scheduledStart).getTime() - Date.now()
  return diff >= 0 && diff <= 30 * 60 * 1000
}

export function formatMeetingTime(meeting: VirtualMeeting): string {
  if (!meeting.scheduledStart) return 'No time set'
  const start = new Date(meeting.scheduledStart)
  const opts: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }
  let label = start.toLocaleString(undefined, opts)
  if (meeting.scheduledEnd) {
    const end = new Date(meeting.scheduledEnd)
    label += ' – ' + end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  }
  return label
}
