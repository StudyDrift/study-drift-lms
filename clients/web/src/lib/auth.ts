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
