import { authorizedFetch } from './api'
import { readApiErrorMessage } from './errors'

export type DiscussionForum = {
  id: string
  name: string
  description?: string | null
  position: number
  createdAt: string
}

export type DiscussionThreadSummary = {
  id: string
  forumId: string
  authorId: string
  title: string
  isPinned: boolean
  isLocked: boolean
  requirePostFirst: boolean
  assignmentStructureItemId?: string | null
  createdAt: string
  updatedAt: string
  replyCount: number
}

export type DiscussionThreadDetail = DiscussionThreadSummary & {
  body: unknown
}

export type DiscussionPost = {
  id: string
  threadId: string
  parentPostId?: string | null
  authorId: string
  body: unknown
  upvoteCount: number
  viewerUpvoted: boolean
  createdAt: string
  updatedAt: string
}

export async function fetchDiscussionForums(courseCode: string): Promise<DiscussionForum[]> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/forums`,
  )
  const raw: unknown = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  const o = raw as { forums?: DiscussionForum[] }
  return o.forums ?? []
}

export async function createDiscussionForum(
  courseCode: string,
  body: { name: string; description?: string; position?: number },
): Promise<DiscussionForum> {
  const res = await authorizedFetch(`/api/v1/courses/${encodeURIComponent(courseCode)}/forums`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const raw: unknown = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw as DiscussionForum
}

export async function fetchDiscussionThreads(
  courseCode: string,
  forumId: string,
): Promise<DiscussionThreadSummary[]> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/forums/${encodeURIComponent(forumId)}/threads`,
  )
  const raw: unknown = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  const o = raw as { threads?: DiscussionThreadSummary[] }
  return o.threads ?? []
}

export async function createDiscussionThread(
  courseCode: string,
  forumId: string,
  body: {
    title: string
    body: unknown
    assignmentStructureItemId?: string | null
    requirePostFirst?: boolean
  },
): Promise<DiscussionThreadDetail> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/forums/${encodeURIComponent(forumId)}/threads`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
  const raw: unknown = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw as DiscussionThreadDetail
}

export async function fetchDiscussionThread(
  courseCode: string,
  threadId: string,
): Promise<DiscussionThreadDetail> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/discussion-threads/${encodeURIComponent(threadId)}`,
  )
  const raw: unknown = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw as DiscussionThreadDetail
}

export async function patchDiscussionThread(
  courseCode: string,
  threadId: string,
  patch: { isPinned?: boolean; isLocked?: boolean; title?: string },
): Promise<DiscussionThreadDetail> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/discussion-threads/${encodeURIComponent(threadId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    },
  )
  const raw: unknown = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw as DiscussionThreadDetail
}

export async function fetchDiscussionPosts(
  courseCode: string,
  threadId: string,
): Promise<{ posts: DiscussionPost[]; hiddenUntilFirstPost: boolean }> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/discussion-threads/${encodeURIComponent(threadId)}/posts`,
  )
  const raw: unknown = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  const o = raw as { posts?: DiscussionPost[]; hiddenUntilFirstPost?: boolean }
  return { posts: o.posts ?? [], hiddenUntilFirstPost: Boolean(o.hiddenUntilFirstPost) }
}

export async function createDiscussionPost(
  courseCode: string,
  threadId: string,
  body: { parentPostId?: string | null; body: unknown; idempotencyKey?: string },
): Promise<DiscussionPost> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/discussion-threads/${encodeURIComponent(threadId)}/posts`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
  const raw: unknown = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw as DiscussionPost
}

export async function deleteDiscussionPost(courseCode: string, postId: string): Promise<void> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/discussion-posts/${encodeURIComponent(postId)}`,
    { method: 'DELETE' },
  )
  if (res.status === 204) return
  const raw: unknown = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
}

export async function upvoteDiscussionPost(
  courseCode: string,
  postId: string,
): Promise<{ wasAdded: boolean; upvoteCount: number }> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/discussion-posts/${encodeURIComponent(postId)}/upvote`,
    { method: 'POST' },
  )
  const raw: unknown = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw as { wasAdded: boolean; upvoteCount: number }
}

export const emptyTipTapDoc = Object.freeze({
  type: 'doc',
  content: [{ type: 'paragraph', content: [] }],
})
