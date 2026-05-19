import { authorizedFetch } from './api'
import { readApiErrorMessage } from './errors'

export interface GroupPublic {
  id: string
  groupSetId: string
  name: string
  sortOrder: number
  createdAt: string
  memberCount: number
}

export interface GroupChannel {
  id: string
  name: string
  sortOrder: number
  createdAt: string
}

export interface GroupMessage {
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
  replies: GroupMessage[]
}

function enc(s: string): string {
  return encodeURIComponent(s)
}

/** Fetch groups the current user belongs to in this course (student view). */
export async function fetchMyGroups(courseCode: string): Promise<GroupPublic[]> {
  const res = await authorizedFetch(`/api/v1/courses/${enc(courseCode)}/my-groups`)
  const raw: unknown = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  const o = raw as { groups?: GroupPublic[] }
  return o.groups ?? []
}

/** Fetch all groups for a course (instructor view). */
export async function fetchAllGroups(courseCode: string): Promise<GroupPublic[]> {
  const res = await authorizedFetch(`/api/v1/courses/${enc(courseCode)}/groups`)
  const raw: unknown = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  const o = raw as { groups?: GroupPublic[] }
  return o.groups ?? []
}

/** Fetch the feed channels for a group. */
export async function fetchGroupChannels(courseCode: string, groupId: string): Promise<GroupChannel[]> {
  const res = await authorizedFetch(
    `/api/v1/courses/${enc(courseCode)}/groups/${enc(groupId)}/feed/channels`,
  )
  const raw: unknown = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  const o = raw as { channels?: GroupChannel[] }
  return o.channels ?? []
}

/** Create a new feed channel for a group (instructor only). */
export async function createGroupChannel(
  courseCode: string,
  groupId: string,
  name: string,
): Promise<GroupChannel> {
  const res = await authorizedFetch(
    `/api/v1/courses/${enc(courseCode)}/groups/${enc(groupId)}/feed/channels`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    },
  )
  const raw: unknown = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw as GroupChannel
}

/** Fetch messages in a group channel. */
export async function fetchGroupMessages(
  courseCode: string,
  groupId: string,
  channelId: string,
): Promise<GroupMessage[]> {
  const res = await authorizedFetch(
    `/api/v1/courses/${enc(courseCode)}/groups/${enc(groupId)}/feed/channels/${enc(channelId)}/messages`,
  )
  const raw: unknown = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  const o = raw as { messages?: GroupMessage[] }
  return o.messages ?? []
}

/** Post a message to a group channel. */
export async function postGroupMessage(
  courseCode: string,
  groupId: string,
  channelId: string,
  body: string,
  parentMessageId?: string | null,
): Promise<{ id: string }> {
  const res = await authorizedFetch(
    `/api/v1/courses/${enc(courseCode)}/groups/${enc(groupId)}/feed/channels/${enc(channelId)}/messages`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        body,
        parentMessageId: parentMessageId ?? null,
        mentionUserIds: [],
        mentionsEveryone: false,
      }),
    },
  )
  const raw: unknown = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw as { id: string }
}
