import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAccessToken, getAccessToken, setAccessToken } from './auth'

const KEY = 'studydrift_access_token'

function memoryStorage(): Storage {
  const store = new Map<string, string>()
  return {
    get length() {
      return store.size
    },
    clear: () => store.clear(),
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    key: (i: number) => [...store.keys()][i] ?? null,
    removeItem: (k: string) => {
      store.delete(k)
    },
    setItem: (k: string, v: string) => {
      store.set(k, String(v))
    },
  } as Storage
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
})

afterEach(() => {
  vi.unstubAllGlobals()
  clearAccessToken()
})

describe('access token storage', () => {
  it('round-trips token via localStorage', () => {
    setAccessToken('abc')
    expect(localStorage.getItem(KEY)).toBe('abc')
    expect(getAccessToken()).toBe('abc')
  })

  it('clearAccessToken removes token and memory fallback', () => {
    setAccessToken('x')
    clearAccessToken()
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(getAccessToken()).toBeNull()
  })

  it('uses in-memory token when localStorage setItem throws', () => {
    vi.stubGlobal('localStorage', {
      ...memoryStorage(),
      setItem: () => {
        throw new Error('quota')
      },
    } as Storage)
    setAccessToken('mem-only')
    expect(getAccessToken()).toBe('mem-only')
  })

  it('dispatches studydrift-auth-token when token changes', () => {
    const listener = vi.fn()
    window.addEventListener('studydrift-auth-token', listener)
    setAccessToken('t1')
    expect(listener).toHaveBeenCalledTimes(1)
    clearAccessToken()
    expect(listener).toHaveBeenCalledTimes(2)
    window.removeEventListener('studydrift-auth-token', listener)
  })
})
