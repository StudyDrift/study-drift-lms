import { getAccessToken } from './auth'
import {
  applyAuthTokenResponse,
  clearSessionTokens,
  getRefreshToken,
} from './session-tokens'

const defaultApi = 'http://localhost:8080'

/** Resolves the API origin. Treats empty/whitespace VITE_API_URL as unset (Docker/.env can set it to ""). */
export function apiBaseUrl(): string {
  const v = import.meta.env.VITE_API_URL
  if (v == null) return defaultApi
  const s = String(v).trim()
  return s !== '' ? s : defaultApi
}

const MAX_IDEMPOTENT_ATTEMPTS = 3
const BASE_BACKOFF_MS = 250

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/** Exponential backoff with jitter (50%–100% of base × 2^attempt). */
export function backoffWithJitterMs(attempt: number): number {
  const base = BASE_BACKOFF_MS * 2 ** attempt
  return base * (0.5 + Math.random() * 0.5)
}

/** Pure URL join — unit-tested without env; used by {@link apiUrl}. */
export function joinApiBase(base: string, path: string): string {
  const b = base.replace(/\/$/, '')
  const p = path.startsWith('/') ? path : `/${path}`
  return `${b}${p}`
}

export function apiUrl(path: string): string {
  return joinApiBase(apiBaseUrl(), path)
}

/** WebSocket URL for the same API host as {@link apiUrl}. */
export function wsUrl(path: string): string {
  return apiUrl(path).replace(/^http/, 'ws')
}

function dispatchAuthRequired(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('studydrift-auth-required'))
  }
}

function applyUnauthorizedHandling(res: Response): void {
  if (res.status === 401) {
    clearSessionTokens()
    dispatchAuthRequired()
  }
}

let refreshInFlight: Promise<boolean> | null = null

/** POST /api/v1/auth/refresh; returns true when a new access token was stored. */
export async function tryRefreshSession(): Promise<boolean> {
  const rt = getRefreshToken()
  if (!rt) {
    return false
  }
  if (refreshInFlight) {
    return refreshInFlight
  }
  refreshInFlight = (async () => {
    try {
      const res = await fetch(apiUrl('/api/v1/auth/refresh'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: rt }),
      })
      if (!res.ok) {
        clearSessionTokens()
        dispatchAuthRequired()
        return false
      }
      const raw: unknown = await res.json().catch(() => ({}))
      const data = raw as { access_token?: string; refresh_token?: string }
      if (!data.access_token) {
        clearSessionTokens()
        dispatchAuthRequired()
        return false
      }
      applyAuthTokenResponse(data)
      return true
    } catch {
      clearSessionTokens()
      dispatchAuthRequired()
      return false
    } finally {
      refreshInFlight = null
    }
  })()
  return refreshInFlight
}

/**
 * `fetch` to the API with `Authorization: Bearer` when a token exists.
 * GET/HEAD requests retry transient 5xx responses and network failures (with jittered backoff).
 */
export async function authorizedFetch(path: string, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase()
  const allowRetry = method === 'GET' || method === 'HEAD'
  const attempts = allowRetry ? MAX_IDEMPOTENT_ATTEMPTS : 1

  let lastNetworkError: unknown

  for (let attempt = 0; attempt < attempts; attempt++) {
    const headers = new Headers(init?.headers)
    const token = getAccessToken()
    if (token) {
      headers.set('Authorization', `Bearer ${token}`)
    }

    try {
      let res = await fetch(apiUrl(path), { ...init, headers })

      if (res.status === 401 && getRefreshToken() && path !== '/api/v1/auth/refresh') {
        const ok = await tryRefreshSession()
        if (ok) {
          const h2 = new Headers(init?.headers)
          const t2 = getAccessToken()
          if (t2) {
            h2.set('Authorization', `Bearer ${t2}`)
          }
          res = await fetch(apiUrl(path), { ...init, headers: h2 })
        }
      }

      applyUnauthorizedHandling(res)

      const transient =
        allowRetry &&
        attempt < attempts - 1 &&
        res.status >= 500 &&
        res.status < 600

      if (transient) {
        await sleep(backoffWithJitterMs(attempt))
        continue
      }

      return res
    } catch (err) {
      lastNetworkError = err
      if (allowRetry && attempt < attempts - 1) {
        await sleep(backoffWithJitterMs(attempt))
        continue
      }
      throw err
    }
  }

  throw lastNetworkError ?? new Error('authorizedFetch: exhausted retries without response')
}
