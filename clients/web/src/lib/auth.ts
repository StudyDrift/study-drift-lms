const ACCESS_TOKEN_KEY = 'studydrift_access_token'

/** In-memory fallback when `localStorage` is unavailable (tests, private mode). */
let memoryToken: string | null = null

function notifyAuthTokenListeners(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('studydrift-auth-token'))
  }
}

export function setAccessToken(token: string): void {
  try {
    localStorage.setItem(ACCESS_TOKEN_KEY, token)
    memoryToken = null
  } catch {
    memoryToken = token
  }
  notifyAuthTokenListeners()
}

export function getAccessToken(): string | null {
  try {
    return localStorage.getItem(ACCESS_TOKEN_KEY) ?? memoryToken
  } catch {
    return memoryToken
  }
}

export function clearAccessToken(): void {
  memoryToken = null
  try {
    localStorage.removeItem(ACCESS_TOKEN_KEY)
  } catch {
    /* ignore */
  }
  notifyAuthTokenListeners()
}

/** JWT `sub` claim for the current access token, if parseable. */
export function getJwtSubject(): string | null {
  const t = getAccessToken()
  if (!t) return null
  const seg = t.split('.')[1]
  if (!seg) return null
  try {
    const json = atob(seg.replace(/-/g, '+').replace(/_/g, '/'))
    const o = JSON.parse(json) as { sub?: string }
    return typeof o.sub === 'string' ? o.sub : null
  } catch {
    return null
  }
}
