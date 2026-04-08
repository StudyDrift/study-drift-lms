import { authorizedFetch } from './api'
import { getAccessToken } from './auth'

export type MailboxParty = {
  name: string
  email: string
}

export type MailboxMessage = {
  id: string
  from: MailboxParty
  to: string
  subject: string
  snippet: string
  body: string
  sent_at: string
  read: boolean
  starred: boolean
  folder: 'inbox' | 'sent' | 'drafts' | 'trash'
  has_attachment: boolean
}

export type MailboxFolder = 'inbox' | 'starred' | 'sent' | 'drafts' | 'trash'

export async function fetchMailboxMessages(folder: MailboxFolder, q: string): Promise<MailboxMessage[]> {
  const params = new URLSearchParams({ folder, q: q.trim() })
  const res = await authorizedFetch(`/api/v1/communication/messages?${params}`)
  if (!res.ok) {
    throw new Error(`Failed to load messages (${res.status})`)
  }
  const data = (await res.json()) as { messages: MailboxMessage[] }
  return data.messages
}

export async function fetchUnreadInboxCount(): Promise<number> {
  const res = await authorizedFetch('/api/v1/communication/unread-count')
  if (!res.ok) {
    throw new Error(`Failed to load unread count (${res.status})`)
  }
  const data = (await res.json()) as { unread_inbox: number }
  return data.unread_inbox
}

export async function patchMailbox(
  messageId: string,
  body: { read?: boolean; starred?: boolean; folder?: 'inbox' | 'sent' | 'drafts' | 'trash' },
): Promise<void> {
  const res = await authorizedFetch(`/api/v1/communication/messages/${messageId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new Error(`Failed to update message (${res.status})`)
  }
}

export async function sendMessage(
  body: { to_email?: string; subject: string; body: string; draft?: boolean },
): Promise<string> {
  const res = await authorizedFetch('/api/v1/communication/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new Error(`Failed to send message (${res.status})`)
  }
  const data = (await res.json()) as { id: string }
  return data.id
}

/** WebSocket URL for mailbox notifications (token in query). */
export function mailboxWebSocketUrl(): string | null {
  const token = getAccessToken()
  if (!token) return null
  const base = import.meta.env.VITE_API_URL ?? 'http://localhost:8080'
  const u = new URL(base)
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
  const qs = new URLSearchParams({ token })
  return `${u.origin}/api/v1/communication/ws?${qs.toString()}`
}

export function parseMailboxWsMessage(raw: string): { type?: string } | null {
  try {
    return JSON.parse(raw) as { type?: string }
  } catch {
    return null
  }
}
