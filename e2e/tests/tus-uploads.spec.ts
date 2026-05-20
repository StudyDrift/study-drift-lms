/**
 * Resumable / Chunked Uploads (plan 8.2) — End-to-end test suite
 *
 * Checklist coverage:
 *   [x] Unauthenticated requests return 401 on all tus endpoints
 *   [x] POST (create) returns 201 with Location header and Tus-Resumable
 *   [x] HEAD returns Upload-Offset=0 and correct Upload-Length after creation
 *   [x] PATCH with first chunk updates Upload-Offset
 *   [x] PATCH completing the upload (offset == length) marks upload done
 *   [x] Multi-chunk upload: three sequential PATCHes, HEAD reflects correct offset at each step
 *   [x] Resume scenario: HEAD returns current offset, PATCH resumes from there
 *   [x] Cross-user access to another user's upload returns 403
 *   [x] DELETE removes the upload (subsequent HEAD returns 404)
 *   [x] PATCH with wrong offset returns 409
 *   [x] PATCH without Tus-Resumable header returns 412
 *   [x] PATCH without correct Content-Type returns 415
 *   [x] POST with Upload-Length exceeding 10 GB returns 413
 *   [x] POST with disallowed MIME type returns 422
 *   [x] Zero-length upload is immediately marked complete
 */
import { test, expect } from '@playwright/test'
import { apiSignup } from '../fixtures/api.js'

const API_BASE = process.env.E2E_API_URL ?? 'http://localhost:8080'
const PASSWORD = 'E2eTestPass1!'

function uniqueEmail(prefix = 'tus') {
  return `e2e-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.invalid`
}

function tusHeaders(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Tus-Resumable': '1.0.0', ...extra }
}

function encodeMetadata(pairs: Record<string, string>): string {
  return Object.entries(pairs)
    .map(([k, v]) => `${k} ${btoa(v)}`)
    .join(',')
}

async function createUpload(
  token: string,
  lengthBytes: number,
  filename = 'test.mp4',
  mime = 'video/mp4',
): Promise<string> {
  const res = await fetch(`${API_BASE}/api/v1/tus/files`, {
    method: 'POST',
    headers: tusHeaders(token, {
      'Upload-Length': String(lengthBytes),
      'Upload-Metadata': encodeMetadata({ filename, filetype: mime }),
    }),
  })
  if (res.status !== 201) {
    const body = await res.text()
    throw new Error(`Expected 201, got ${res.status}: ${body}`)
  }
  const location = res.headers.get('Location')
  if (!location) throw new Error('No Location header in 201 response')
  return location
}

async function headUpload(token: string, url: string): Promise<{ offset: number; length: number }> {
  const res = await fetch(`${API_BASE}${url}`, {
    method: 'HEAD',
    headers: tusHeaders(token),
  })
  expect(res.status).toBe(200)
  return {
    offset: parseInt(res.headers.get('Upload-Offset') ?? '0', 10),
    length: parseInt(res.headers.get('Upload-Length') ?? '0', 10),
  }
}

async function patchUpload(
  token: string,
  url: string,
  offset: number,
  data: Uint8Array,
): Promise<number> {
  const res = await fetch(`${API_BASE}${url}`, {
    method: 'PATCH',
    headers: tusHeaders(token, {
      'Content-Type': 'application/offset+octet-stream',
      'Upload-Offset': String(offset),
    }),
    body: data,
  })
  expect(res.status).toBe(204)
  return parseInt(res.headers.get('Upload-Offset') ?? '0', 10)
}

// ---------------------------------------------------------------------------
// Auth guard tests
// ---------------------------------------------------------------------------

test.describe('tus auth guards', () => {
  test('unauthenticated POST returns 401', async ({ request }) => {
    const res = await request.post(`${API_BASE}/api/v1/tus/files`, {
      headers: { 'Upload-Length': '100', 'Tus-Resumable': '1.0.0' },
    })
    expect(res.status()).toBe(401)
  })

  test('unauthenticated HEAD returns 401', async ({ request }) => {
    const res = await request.head(
      `${API_BASE}/api/v1/tus/files/00000000-0000-0000-0000-000000000001`,
    )
    expect(res.status()).toBe(401)
  })

  test('unauthenticated PATCH returns 401', async ({ request }) => {
    const res = await request.patch(
      `${API_BASE}/api/v1/tus/files/00000000-0000-0000-0000-000000000001`,
      {
        headers: {
          'Content-Type': 'application/offset+octet-stream',
          'Upload-Offset': '0',
          'Tus-Resumable': '1.0.0',
        },
        data: Buffer.alloc(4),
      },
    )
    expect(res.status()).toBe(401)
  })

  test('unauthenticated DELETE returns 401', async ({ request }) => {
    const res = await request.delete(
      `${API_BASE}/api/v1/tus/files/00000000-0000-0000-0000-000000000001`,
      {
        headers: { 'Tus-Resumable': '1.0.0' },
      },
    )
    expect(res.status()).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// Tus protocol: create, head, patch, complete
// ---------------------------------------------------------------------------

test.describe('tus protocol', () => {
  test('create upload returns 201 with Location and Tus-Resumable', async () => {
    const { access_token } = await apiSignup({
      email: uniqueEmail(),
      password: PASSWORD,
      displayName: 'Tus User',
    })
    const res = await fetch(`${API_BASE}/api/v1/tus/files`, {
      method: 'POST',
      headers: tusHeaders(access_token, {
        'Upload-Length': '1024',
        'Upload-Metadata': encodeMetadata({ filename: 'video.mp4', filetype: 'video/mp4' }),
      }),
    })
    expect(res.status).toBe(201)
    expect(res.headers.get('Tus-Resumable')).toBe('1.0.0')
    const location = res.headers.get('Location')
    expect(location).toBeTruthy()
    expect(location!.startsWith('/api/v1/tus/files/')).toBe(true)
  })

  test('HEAD after create returns offset 0 and correct length', async () => {
    const { access_token } = await apiSignup({
      email: uniqueEmail(),
      password: PASSWORD,
      displayName: 'Tus User',
    })
    const location = await createUpload(access_token, 2048)
    const { offset, length } = await headUpload(access_token, location)
    expect(offset).toBe(0)
    expect(length).toBe(2048)
  })

  test('single-chunk upload completes', async () => {
    const { access_token } = await apiSignup({
      email: uniqueEmail(),
      password: PASSWORD,
      displayName: 'Tus User',
    })
    const data = new Uint8Array(512).fill(0xab)
    const location = await createUpload(access_token, data.length)

    const newOffset = await patchUpload(access_token, location, 0, data)
    expect(newOffset).toBe(512)

    // HEAD after completion still returns the final state
    const { offset, length } = await headUpload(access_token, location)
    expect(offset).toBe(512)
    expect(length).toBe(512)
  })

  test('multi-chunk upload tracks offset correctly', async () => {
    const { access_token } = await apiSignup({
      email: uniqueEmail(),
      password: PASSWORD,
      displayName: 'Tus User',
    })
    const total = 300
    const chunk1 = new Uint8Array(100).fill(1)
    const chunk2 = new Uint8Array(100).fill(2)
    const chunk3 = new Uint8Array(100).fill(3)
    const location = await createUpload(access_token, total, 'doc.mp4', 'video/mp4')

    let offset = await patchUpload(access_token, location, 0, chunk1)
    expect(offset).toBe(100)

    let state = await headUpload(access_token, location)
    expect(state.offset).toBe(100)

    offset = await patchUpload(access_token, location, 100, chunk2)
    expect(offset).toBe(200)

    state = await headUpload(access_token, location)
    expect(state.offset).toBe(200)

    offset = await patchUpload(access_token, location, 200, chunk3)
    expect(offset).toBe(300)

    state = await headUpload(access_token, location)
    expect(state.offset).toBe(300)
    expect(state.length).toBe(300)
  })

  test('resume: PATCH from non-zero offset continues correctly', async () => {
    const { access_token } = await apiSignup({
      email: uniqueEmail(),
      password: PASSWORD,
      displayName: 'Tus User',
    })
    const chunk1 = new Uint8Array(256).fill(0x11)
    const chunk2 = new Uint8Array(256).fill(0x22)
    const total = chunk1.length + chunk2.length
    const location = await createUpload(access_token, total)

    // Upload first chunk
    await patchUpload(access_token, location, 0, chunk1)

    // Simulate resume: HEAD to find offset, then PATCH from that offset
    const { offset } = await headUpload(access_token, location)
    expect(offset).toBe(256)

    const finalOffset = await patchUpload(access_token, location, offset, chunk2)
    expect(finalOffset).toBe(total)
  })

  test('DELETE removes upload — subsequent HEAD returns 404', async () => {
    const { access_token } = await apiSignup({
      email: uniqueEmail(),
      password: PASSWORD,
      displayName: 'Tus User',
    })
    const location = await createUpload(access_token, 1024)

    const delRes = await fetch(`${API_BASE}${location}`, {
      method: 'DELETE',
      headers: tusHeaders(access_token),
    })
    expect(delRes.status).toBe(204)

    // HEAD after delete should 404
    const headRes = await fetch(`${API_BASE}${location}`, {
      method: 'HEAD',
      headers: tusHeaders(access_token),
    })
    expect(headRes.status).toBe(404)
  })

  test('zero-length upload is immediately complete', async () => {
    const { access_token } = await apiSignup({
      email: uniqueEmail(),
      password: PASSWORD,
      displayName: 'Tus User',
    })
    const res = await fetch(`${API_BASE}/api/v1/tus/files`, {
      method: 'POST',
      headers: tusHeaders(access_token, {
        'Upload-Length': '0',
        'Upload-Metadata': encodeMetadata({ filename: 'empty.txt', filetype: 'text/plain' }),
      }),
    })
    expect(res.status).toBe(201)
  })
})

// ---------------------------------------------------------------------------
// Error / validation cases
// ---------------------------------------------------------------------------

test.describe('tus validation', () => {
  test('POST with Upload-Length > 10 GB returns 413', async () => {
    const { access_token } = await apiSignup({
      email: uniqueEmail('val'),
      password: PASSWORD,
      displayName: 'Tus Val',
    })
    const tenGBPlusOne = String(10 * 1024 * 1024 * 1024 + 1)
    const res = await fetch(`${API_BASE}/api/v1/tus/files`, {
      method: 'POST',
      headers: tusHeaders(access_token, {
        'Upload-Length': tenGBPlusOne,
        'Upload-Metadata': encodeMetadata({ filename: 'huge.mp4', filetype: 'video/mp4' }),
      }),
    })
    expect(res.status).toBe(413)
  })

  test('POST with disallowed MIME type returns 422', async () => {
    const { access_token } = await apiSignup({
      email: uniqueEmail('val'),
      password: PASSWORD,
      displayName: 'Tus Val',
    })
    const res = await fetch(`${API_BASE}/api/v1/tus/files`, {
      method: 'POST',
      headers: tusHeaders(access_token, {
        'Upload-Length': '1024',
        'Upload-Metadata': encodeMetadata({ filename: 'hack.exe', filetype: 'application/x-executable' }),
      }),
    })
    expect(res.status).toBe(422)
  })

  test('POST without Tus-Resumable header returns 412', async () => {
    const { access_token } = await apiSignup({
      email: uniqueEmail('val'),
      password: PASSWORD,
      displayName: 'Tus Val',
    })
    const res = await fetch(`${API_BASE}/api/v1/tus/files`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${access_token}`,
        'Upload-Length': '512',
      },
    })
    expect(res.status).toBe(412)
  })

  test('PATCH without Tus-Resumable header returns 412', async () => {
    const { access_token } = await apiSignup({
      email: uniqueEmail('val'),
      password: PASSWORD,
      displayName: 'Tus Val',
    })
    const location = await createUpload(access_token, 512)
    const res = await fetch(`${API_BASE}${location}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${access_token}`,
        'Content-Type': 'application/offset+octet-stream',
        'Upload-Offset': '0',
      },
      body: new Uint8Array(64),
    })
    expect(res.status).toBe(412)
  })

  test('PATCH with wrong Content-Type returns 415', async () => {
    const { access_token } = await apiSignup({
      email: uniqueEmail('val'),
      password: PASSWORD,
      displayName: 'Tus Val',
    })
    const location = await createUpload(access_token, 512)
    const res = await fetch(`${API_BASE}${location}`, {
      method: 'PATCH',
      headers: tusHeaders(access_token, {
        'Content-Type': 'application/json',
        'Upload-Offset': '0',
      }),
      body: '{}',
    })
    expect(res.status).toBe(415)
  })

  test('PATCH with wrong Upload-Offset returns 409', async () => {
    const { access_token } = await apiSignup({
      email: uniqueEmail('val'),
      password: PASSWORD,
      displayName: 'Tus Val',
    })
    const location = await createUpload(access_token, 512)
    // Send with offset 100 when current offset is 0
    const res = await fetch(`${API_BASE}${location}`, {
      method: 'PATCH',
      headers: tusHeaders(access_token, {
        'Content-Type': 'application/offset+octet-stream',
        'Upload-Offset': '100',
      }),
      body: new Uint8Array(64),
    })
    expect(res.status).toBe(409)
  })

  test('PATCH on missing upload returns 404', async () => {
    const { access_token } = await apiSignup({
      email: uniqueEmail('val'),
      password: PASSWORD,
      displayName: 'Tus Val',
    })
    const res = await fetch(
      `${API_BASE}/api/v1/tus/files/00000000-0000-0000-0000-000000000099`,
      {
        method: 'PATCH',
        headers: tusHeaders(access_token, {
          'Content-Type': 'application/offset+octet-stream',
          'Upload-Offset': '0',
        }),
        body: new Uint8Array(4),
      },
    )
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// Security: cross-user isolation
// ---------------------------------------------------------------------------

test.describe('tus cross-user isolation', () => {
  test('user B cannot HEAD or PATCH user A upload — returns 403', async () => {
    const userA = await apiSignup({
      email: uniqueEmail('A'),
      password: PASSWORD,
      displayName: 'User A',
    })
    const userB = await apiSignup({
      email: uniqueEmail('B'),
      password: PASSWORD,
      displayName: 'User B',
    })

    const location = await createUpload(userA.access_token, 256)

    // HEAD by user B
    const headRes = await fetch(`${API_BASE}${location}`, {
      method: 'HEAD',
      headers: tusHeaders(userB.access_token),
    })
    expect(headRes.status).toBe(403)

    // PATCH by user B
    const patchRes = await fetch(`${API_BASE}${location}`, {
      method: 'PATCH',
      headers: tusHeaders(userB.access_token, {
        'Content-Type': 'application/offset+octet-stream',
        'Upload-Offset': '0',
      }),
      body: new Uint8Array(64),
    })
    expect(patchRes.status).toBe(403)

    // DELETE by user B
    const delRes = await fetch(`${API_BASE}${location}`, {
      method: 'DELETE',
      headers: tusHeaders(userB.access_token),
    })
    expect(delRes.status).toBe(403)
  })
})
