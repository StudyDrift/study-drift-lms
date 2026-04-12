import { authorizedFetch } from './api'
import { readApiErrorMessage } from './errors'

export type FeedChannel = {
  id: string
  name: string
  sortOrder: number
  createdAt: string
}

export type FeedRosterPerson = {
  userId: string
  email: string
  displayName: string | null
}

export type FeedMessage = {
  id: string
  channelId: string
  authorUserId: string
  authorEmail: string
  authorDisplayName: string | null
  parentMessageId: string | null
  body: string
  mentionsEveryone: boolean
  mentionUserIds: string[]
  pinnedAt: string | null
  createdAt: string
  editedAt: string | null
  likeCount: number
  viewerHasLiked: boolean
  replies: FeedMessage[]
}

function enc(cc: string) {
  return encodeURIComponent(cc)
}

export async function fetchFeedChannels(courseCode: string): Promise<FeedChannel[]> {
  const res = await authorizedFetch(`/api/v1/courses/${enc(courseCode)}/feed/channels`)
  const raw: unknown = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  const o = raw as { channels?: FeedChannel[] }
  return o.channels ?? []
}

export async function createFeedChannel(courseCode: string, name: string): Promise<FeedChannel> {
  const res = await authorizedFetch(`/api/v1/courses/${enc(courseCode)}/feed/channels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  const raw: unknown = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw as FeedChannel
}

export async function fetchFeedRoster(courseCode: string): Promise<FeedRosterPerson[]> {
  const res = await authorizedFetch(`/api/v1/courses/${enc(courseCode)}/feed/roster`)
  const raw: unknown = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  const o = raw as { people?: FeedRosterPerson[] }
  return o.people ?? []
}

export async function fetchFeedMessages(
  courseCode: string,
  channelId: string,
): Promise<FeedMessage[]> {
  const res = await authorizedFetch(
    `/api/v1/courses/${enc(courseCode)}/feed/channels/${encodeURIComponent(channelId)}/messages`,
  )
  const raw: unknown = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  const o = raw as { messages?: FeedMessage[] }
  return o.messages ?? []
}

export type FeedImageUploadResponse = {
  id: string
  /** Path-only URL (`/api/v1/courses/.../course-files/.../content`). */
  contentPath: string
  mimeType: string
  byteSize: number
}

/** Multipart image upload for feed messages (enrolled students; same storage as course images). */
export async function uploadFeedImage(
  courseCode: string,
  file: File,
): Promise<FeedImageUploadResponse> {
  const body = new FormData()
  body.append('file', file)
  const res = await authorizedFetch(`/api/v1/courses/${enc(courseCode)}/feed/upload-image`, {
    method: 'POST',
    body,
  })
  const raw: unknown = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  const o = raw as {
    id: string
    content_path: string
    mime_type: string
    byte_size: number
  }
  return {
    id: o.id,
    contentPath: o.content_path,
    mimeType: o.mime_type,
    byteSize: o.byte_size,
  }
}

export async function postFeedMessage(
  courseCode: string,
  channelId: string,
  body: {
    body: string
    parentMessageId?: string | null
    mentionUserIds: string[]
    mentionsEveryone: boolean
  },
): Promise<string> {
  const res = await authorizedFetch(
    `/api/v1/courses/${enc(courseCode)}/feed/channels/${encodeURIComponent(channelId)}/messages`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        body: body.body,
        parentMessageId: body.parentMessageId ?? undefined,
        mentionUserIds: body.mentionUserIds,
        mentionsEveryone: body.mentionsEveryone,
      }),
    },
  )
  const raw: unknown = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return (raw as { id: string }).id
}

export async function patchFeedMessage(courseCode: string, messageId: string, body: string) {
  const res = await authorizedFetch(
    `/api/v1/courses/${enc(courseCode)}/feed/messages/${encodeURIComponent(messageId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    },
  )
  const raw: unknown = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
}

export async function pinFeedMessage(courseCode: string, messageId: string, pinned: boolean) {
  const res = await authorizedFetch(
    `/api/v1/courses/${enc(courseCode)}/feed/messages/${encodeURIComponent(messageId)}/pin`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned }),
    },
  )
  const raw: unknown = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
}

export async function likeFeedMessage(courseCode: string, messageId: string) {
  const res = await authorizedFetch(
    `/api/v1/courses/${enc(courseCode)}/feed/messages/${encodeURIComponent(messageId)}/like`,
    { method: 'POST' },
  )
  const raw: unknown = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
}

export async function unlikeFeedMessage(courseCode: string, messageId: string) {
  const res = await authorizedFetch(
    `/api/v1/courses/${enc(courseCode)}/feed/messages/${encodeURIComponent(messageId)}/like`,
    { method: 'DELETE' },
  )
  const raw: unknown = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
}

export function emailLocalPart(email: string): string {
  const i = email.indexOf('@')
  const s = (i > 0 ? email.slice(0, i) : email).trim()
  return s || email
}

/** Stable @-label for each roster member (disambiguates duplicate display names). */
export function rosterMentionLabels(roster: FeedRosterPerson[]): Map<string, string> {
  const norm = (p: FeedRosterPerson) =>
    (p.displayName?.trim() || emailLocalPart(p.email)).toLowerCase()
  const counts = new Map<string, number>()
  for (const p of roster) {
    const k = norm(p)
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const map = new Map<string, string>()
  for (const p of roster) {
    const base = p.displayName?.trim() || emailLocalPart(p.email)
    const dup = (counts.get(norm(p)) ?? 0) > 1
    map.set(p.userId, dup ? `${base} (${p.email})` : base)
  }
  return map
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Resolves @displayName (and legacy @uuid) segments to enrolled user ids. */
export function collectMentionUserIdsFromBody(body: string, roster: FeedRosterPerson[]): string[] {
  const labels = rosterMentionLabels(roster)
  const ids = new Set<string>()
  const pairs = roster.map((p) => ({ id: p.userId, label: labels.get(p.userId)! }))
  pairs.sort((a, b) => b.label.length - a.label.length)
  for (const { id, label } of pairs) {
    const re = new RegExp(`@${escapeRegExp(label)}(?:\\W|$)`, 'g')
    if (re.test(body)) ids.add(id)
    re.lastIndex = 0
  }
  const uuidRe = /@([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi
  let m: RegExpExecArray | null
  while ((m = uuidRe.exec(body)) !== null) {
    const uid = m[1].toLowerCase()
    const row = roster.find((r) => r.userId.toLowerCase() === uid)
    if (row) ids.add(row.userId)
  }
  return [...ids]
}

export function bodyHasEveryoneTag(body: string): boolean {
  return /\B@everyone\b/i.test(body)
}
