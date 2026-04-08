import { getAccessToken } from './auth'

const defaultApi = 'http://localhost:8080'

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

/** `fetch` to the API with `Authorization: Bearer` when a token exists. */
export function authorizedFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  const token = getAccessToken()
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  return fetch(apiUrl(path), { ...init, headers })
}
