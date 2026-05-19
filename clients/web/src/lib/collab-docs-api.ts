import { getAccessToken } from './auth'

const apiBase = import.meta.env.VITE_API_URL ?? ''

export type DocType = 'rich_text' | 'whiteboard'

export interface CollabDoc {
  id: string
  courseId: string
  groupId: string | null
  title: string
  docType: DocType
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface CollabDocSnapshot {
  id: string
  docId: string
  authorId: string
  takenAt: string
}

async function authHeaders(): Promise<Record<string, string>> {
  const tok = getAccessToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (tok) headers['Authorization'] = `Bearer ${tok}`
  return headers
}

export async function fetchCollabDocs(courseCode: string): Promise<CollabDoc[]> {
  const res = await fetch(`${apiBase}/api/v1/courses/${encodeURIComponent(courseCode)}/collab-docs`, {
    headers: await authHeaders(),
  })
  if (!res.ok) throw new Error(`fetchCollabDocs failed (${res.status})`)
  const body = (await res.json()) as { docs: CollabDoc[] }
  return body.docs ?? []
}

export async function createCollabDoc(
  courseCode: string,
  title: string,
  docType: DocType = 'rich_text',
): Promise<CollabDoc> {
  const res = await fetch(`${apiBase}/api/v1/courses/${encodeURIComponent(courseCode)}/collab-docs`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ title, docType }),
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`createCollabDoc failed (${res.status}): ${txt}`)
  }
  return res.json() as Promise<CollabDoc>
}

export async function fetchCollabDoc(courseCode: string, docId: string): Promise<CollabDoc> {
  const res = await fetch(
    `${apiBase}/api/v1/courses/${encodeURIComponent(courseCode)}/collab-docs/${encodeURIComponent(docId)}`,
    { headers: await authHeaders() },
  )
  if (!res.ok) throw new Error(`fetchCollabDoc failed (${res.status})`)
  return res.json() as Promise<CollabDoc>
}

export async function patchCollabDoc(
  courseCode: string,
  docId: string,
  title: string,
): Promise<CollabDoc> {
  const res = await fetch(
    `${apiBase}/api/v1/courses/${encodeURIComponent(courseCode)}/collab-docs/${encodeURIComponent(docId)}`,
    {
      method: 'PATCH',
      headers: await authHeaders(),
      body: JSON.stringify({ title }),
    },
  )
  if (!res.ok) throw new Error(`patchCollabDoc failed (${res.status})`)
  return res.json() as Promise<CollabDoc>
}

export async function deleteCollabDoc(courseCode: string, docId: string): Promise<void> {
  const res = await fetch(
    `${apiBase}/api/v1/courses/${encodeURIComponent(courseCode)}/collab-docs/${encodeURIComponent(docId)}`,
    { method: 'DELETE', headers: await authHeaders() },
  )
  if (!res.ok) throw new Error(`deleteCollabDoc failed (${res.status})`)
}

export async function fetchCollabDocSnapshots(
  courseCode: string,
  docId: string,
): Promise<CollabDocSnapshot[]> {
  const res = await fetch(
    `${apiBase}/api/v1/courses/${encodeURIComponent(courseCode)}/collab-docs/${encodeURIComponent(docId)}/snapshots`,
    { headers: await authHeaders() },
  )
  if (!res.ok) throw new Error(`fetchCollabDocSnapshots failed (${res.status})`)
  const body = (await res.json()) as { snapshots: CollabDocSnapshot[] }
  return body.snapshots ?? []
}

/** Build the WebSocket URL for a collaborative document. */
export function collabDocWsUrl(courseCode: string, docId: string): string {
  const base = (import.meta.env.VITE_API_URL ?? window.location.origin)
    .replace(/^https?:\/\//, '')
    .replace(/^http:\/\//, '')
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${base}/api/v1/courses/${encodeURIComponent(courseCode)}/collab-docs/${encodeURIComponent(docId)}/ws`
}
