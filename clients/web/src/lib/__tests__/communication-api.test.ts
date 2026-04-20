import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAccessToken, setAccessToken } from '../auth'
import {
  fetchMailboxMessages,
  fetchUnreadInboxCount,
  mailboxWebSocketUrl,
  parseMailboxWsMessage,
  patchMailbox,
  sendMessage,
} from '../communication-api'
import { server } from '../../test/mocks/server'

describe('parseMailboxWsMessage', () => {
  it('parses JSON objects', () => {
    expect(parseMailboxWsMessage('{"type":"ping"}')).toEqual({ type: 'ping' })
  })

  it('returns null for invalid JSON', () => {
    expect(parseMailboxWsMessage('not json')).toBeNull()
  })
})

describe('mailboxWebSocketUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    clearAccessToken()
  })

  it('returns null when there is no access token', () => {
    clearAccessToken()
    expect(mailboxWebSocketUrl()).toBeNull()
  })

  it('builds ws URL without query token from VITE_API_URL', () => {
    vi.stubEnv('VITE_API_URL', 'https://api.example.com')
    setAccessToken('tok-abc')
    const u = mailboxWebSocketUrl()
    expect(u).toBe('wss://api.example.com/api/v1/communication/ws')
  })
})

describe('mailbox HTTP helpers', () => {
  beforeEach(() => {
    setAccessToken('test-token')
    server.use(
      http.get('http://localhost:8080/api/v1/communication/messages', () => {
        return HttpResponse.json({
          messages: [
            {
              id: 'm1',
              from: { name: 'A', email: 'a@x.com' },
              to: 'b@x.com',
              subject: 'S',
              snippet: '',
              body: '',
              sent_at: new Date().toISOString(),
              read: false,
              starred: false,
              folder: 'inbox',
              has_attachment: false,
            },
          ],
        })
      }),
      http.get('http://localhost:8080/api/v1/communication/unread-count', () => {
        return HttpResponse.json({ unread_inbox: 3 })
      }),
      http.patch('http://localhost:8080/api/v1/communication/messages/:id', () => {
        return new HttpResponse(null, { status: 204 })
      }),
      http.post('http://localhost:8080/api/v1/communication/messages', () => {
        return HttpResponse.json({ id: 'new-id' })
      }),
    )
  })

  it('fetchMailboxMessages returns messages array', async () => {
    const msgs = await fetchMailboxMessages('inbox', '  hi  ')
    expect(msgs).toHaveLength(1)
    expect(msgs[0]!.id).toBe('m1')
  })

  it('fetchUnreadInboxCount returns number', async () => {
    await expect(fetchUnreadInboxCount()).resolves.toBe(3)
  })

  it('patchMailbox resolves on 204', async () => {
    await expect(patchMailbox('m1', { read: true })).resolves.toBeUndefined()
  })

  it('sendMessage returns new id', async () => {
    const id = await sendMessage({ subject: 'x', body: 'y' })
    expect(id).toBe('new-id')
  })
})
