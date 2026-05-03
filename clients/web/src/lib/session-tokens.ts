import {
  clearAccessToken,
  notifyAuthTokenListeners,
  setAccessToken,
} from './auth'

const REFRESH_TOKEN_KEY = 'studydrift_refresh_token'

let memoryRefresh: string | null = null

export function setRefreshToken(token: string): void {
  try {
    localStorage.setItem(REFRESH_TOKEN_KEY, token)
    memoryRefresh = null
  } catch {
    memoryRefresh = token
  }
  notifyAuthTokenListeners()
}

export function getRefreshToken(): string | null {
  try {
    return localStorage.getItem(REFRESH_TOKEN_KEY) ?? memoryRefresh
  } catch {
    return memoryRefresh
  }
}

export function clearRefreshToken(): void {
  memoryRefresh = null
  try {
    localStorage.removeItem(REFRESH_TOKEN_KEY)
  } catch {
    /* ignore */
  }
  notifyAuthTokenListeners()
}

/** Clears access + refresh tokens (logout / failed refresh). */
export function clearSessionTokens(): void {
  clearAccessToken()
  clearRefreshToken()
}

/** Applies login / refresh response fields to storage. */
export function applyAuthTokenResponse(data: {
  access_token?: string
  refresh_token?: string
  expires_in?: number
}): void {
  if (data.access_token) {
    setAccessToken(data.access_token)
  }
  if (data.refresh_token) {
    setRefreshToken(data.refresh_token)
  }
}

export function hasRefreshToken(): boolean {
  return !!getRefreshToken()
}
