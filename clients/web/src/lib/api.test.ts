import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAccessToken, setAccessToken } from './auth'
import { apiUrl, authorizedFetch, joinApiBase } from './api'
import { server } from '../test/mocks/server'

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
})

describe('authorizedFetch', () => {
  beforeEach(() => {
    setAccessToken('test-token')
  })

  afterEach(() => {
    clearAccessToken()
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
})
