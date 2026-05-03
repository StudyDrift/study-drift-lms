import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAccessToken, getAccessToken, setAccessToken } from '../auth'
import {
  clearRefreshToken,
  getRefreshToken,
  setRefreshToken,
} from '../session-tokens'
import { apiBaseUrl, apiUrl, authorizedFetch, backoffWithJitterMs, joinApiBase } from '../api'
import { server } from '../../test/mocks/server'

describe('joinApiBase', () => {
  it('strips trailing slash from base and ensures leading slash on path', () => {
    expect(joinApiBase('http://localhost:8080/', '/api/v1/auth/login')).toBe(
      'http://localhost:8080/api/v1/auth/login',
    )
  })

  it('adds leading slash when path omits it', () => {
    expect(joinApiBase('http://localhost:8080', 'health')).toBe('http://localhost:8080/health')
  })
})

describe('apiUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('uses VITE_API_URL when set', () => {
    vi.stubEnv('VITE_API_URL', 'https://api.example.com')
    expect(apiUrl('/api/v1/x')).toBe('https://api.example.com/api/v1/x')
  })

  it('falls back when VITE_API_URL is empty (e.g. Docker .env placeholder)', () => {
    vi.stubEnv('VITE_API_URL', '')
    expect(apiBaseUrl()).toBe('http://localhost:8080')
    expect(apiUrl('/api/v1/x')).toBe('http://localhost:8080/api/v1/x')
  })
})

describe('backoffWithJitterMs', () => {
  it('returns values in the expected range for attempt 0', () => {
    for (let i = 0; i < 20; i++) {
      const v = backoffWithJitterMs(0)
      expect(v).toBeGreaterThanOrEqual(125)
      expect(v).toBeLessThanOrEqual(250)
    }
  })
})

describe('authorizedFetch', () => {
  beforeEach(() => {
    setAccessToken('test-token')
  })

  afterEach(() => {
    clearAccessToken()
    clearRefreshToken()
  })

  it('sends Authorization Bearer header to the API', async () => {
    let authHeader: string | null = null
    server.use(
      http.get('http://localhost:8080/api/v1/ping', ({ request }) => {
        authHeader = request.headers.get('Authorization')
        return HttpResponse.json({ ok: true })
      }),
    )
    const res = await authorizedFetch('/api/v1/ping')
    expect(res.ok).toBe(true)
    expect(authHeader).toBe('Bearer test-token')
  })

  it('omits Authorization when no token is stored', async () => {
    clearAccessToken()
    let authHeader: string | null = 'unset'
    server.use(
      http.get('http://localhost:8080/api/v1/ping', ({ request }) => {
        authHeader = request.headers.get('Authorization')
        return HttpResponse.json({ ok: true })
      }),
    )
    await authorizedFetch('/api/v1/ping')
    expect(authHeader).toBeNull()
  })

  it('refreshes session on 401 when a refresh token is stored', async () => {
    setAccessToken('expired-access')
    setRefreshToken('rt-old')
    let pingCount = 0
    server.use(
      http.get('http://localhost:8080/api/v1/ping', () => {
        pingCount += 1
        if (pingCount === 1) {
          return HttpResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }
        return HttpResponse.json({ ok: true })
      }),
      http.post('http://localhost:8080/api/v1/auth/refresh', async ({ request }) => {
        const body = (await request.json()) as { refresh_token?: string }
        if (body.refresh_token !== 'rt-old') {
          return HttpResponse.json({ error: 'bad' }, { status: 401 })
        }
        return HttpResponse.json({
          access_token: 'new-access',
          refresh_token: 'rt-new',
          expires_in: 900,
          token_type: 'Bearer',
        })
      }),
    )
    const res = await authorizedFetch('/api/v1/ping')
    expect(res.ok).toBe(true)
    expect(pingCount).toBe(2)
    expect(getAccessToken()).toBe('new-access')
    expect(getRefreshToken()).toBe('rt-new')
  })

  it('clears auth and redirects to login on 401 responses', async () => {
    server.use(
      http.get('http://localhost:8080/api/v1/ping', () => {
        return HttpResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }),
    )
    const authRequiredListener = vi.fn()
    window.addEventListener('studydrift-auth-required', authRequiredListener)

    const res = await authorizedFetch('/api/v1/ping')

    expect(res.status).toBe(401)
    expect(authRequiredListener).toHaveBeenCalledTimes(1)
    expect(getAccessToken()).toBeNull()
    window.removeEventListener('studydrift-auth-required', authRequiredListener)
  })

  it('retries GET once on 502 then returns success', async () => {
    let n = 0
    server.use(
      http.get('http://localhost:8080/api/v1/ping', () => {
        n += 1
        if (n < 2) {
          return HttpResponse.json({ err: true }, { status: 502 })
        }
        return HttpResponse.json({ ok: true })
      }),
    )
    const res = await authorizedFetch('/api/v1/ping')
    expect(res.ok).toBe(true)
    expect(n).toBe(2)
  })

  it('retries GET on 503 then returns success', async () => {
    let n = 0
    server.use(
      http.get('http://localhost:8080/api/v1/ping', () => {
        n += 1
        if (n < 2) {
          return HttpResponse.json({ err: true }, { status: 503 })
        }
        return HttpResponse.json({ ok: true })
      }),
    )
    const res = await authorizedFetch('/api/v1/ping')
    expect(res.ok).toBe(true)
    expect(n).toBe(2)
  })

  it('retries GET once when fetch throws a network error', async () => {
    let n = 0
    server.use(
      http.get('http://localhost:8080/api/v1/ping', () => {
        n += 1
        if (n < 2) {
          return HttpResponse.error()
        }
        return HttpResponse.json({ ok: true })
      }),
    )
    const res = await authorizedFetch('/api/v1/ping')
    expect(res.ok).toBe(true)
    expect(n).toBe(2)
  })

  it('does not retry POST on 502', async () => {
    let n = 0
    server.use(
      http.post('http://localhost:8080/api/v1/ping', () => {
        n += 1
        return HttpResponse.json({ err: true }, { status: 502 })
      }),
    )
    const res = await authorizedFetch('/api/v1/ping', { method: 'POST' })
    expect(res.status).toBe(502)
    expect(n).toBe(1)
  })
})
