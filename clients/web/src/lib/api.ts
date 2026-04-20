import { clearAccessToken, getAccessToken } from './auth'

const defaultApi = 'http://localhost:8080'

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
  const base = import.meta.env.VITE_API_URL ?? defaultApi
  return joinApiBase(base, path)
}

/** WebSocket URL for the same API host as {@link apiUrl}. */
export function wsUrl(path: string): string {
  return apiUrl(path).replace(/^http/, 'ws')
}

function applyUnauthorizedHandling(res: Response): void {
  if (res.status === 401) {
    clearAccessToken()
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('studydrift-auth-required'))
    }
  }
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
      const res = await fetch(apiUrl(path), { ...init, headers })
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
