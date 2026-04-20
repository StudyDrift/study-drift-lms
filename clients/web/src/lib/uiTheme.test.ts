import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyUiTheme,
  parseUiTheme,
  readStoredUiTheme,
  type UiTheme,
  UI_THEME_STORAGE_KEY,
} from './uiTheme'

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

describe('parseUiTheme', () => {
  it('returns dark only for exact dark token (case-insensitive, trimmed)', () => {
    expect(parseUiTheme('dark')).toBe('dark')
    expect(parseUiTheme('  DARK  ')).toBe('dark')
  })

  it('returns light for undefined, empty, or any other value', () => {
    expect(parseUiTheme(undefined)).toBe('light')
    expect(parseUiTheme(null)).toBe('light')
    expect(parseUiTheme('')).toBe('light')
    expect(parseUiTheme('light')).toBe('light')
    expect(parseUiTheme('auto')).toBe('light')
  })
})

describe('applyUiTheme', () => {
  let root: HTMLElement

  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage())
    root = document.documentElement
    root.classList.remove('dark')
    root.style.colorScheme = ''
    window.localStorage.removeItem(UI_THEME_STORAGE_KEY)
  })

  afterEach(() => {
    root.classList.remove('dark')
    root.style.colorScheme = ''
    window.localStorage.removeItem(UI_THEME_STORAGE_KEY)
    vi.unstubAllGlobals()
  })

  function expectTheme(theme: UiTheme) {
    expect(root.classList.contains('dark')).toBe(theme === 'dark')
    expect(root.style.colorScheme).toBe(theme === 'dark' ? 'dark' : 'light')
  }

  it('toggles dark class and color-scheme for dark theme', () => {
    applyUiTheme('dark')
    expectTheme('dark')
    expect(window.localStorage.getItem(UI_THEME_STORAGE_KEY)).toBe('dark')
  })

  it('removes dark class for light theme', () => {
    root.classList.add('dark')
    applyUiTheme('light')
    expectTheme('light')
    expect(window.localStorage.getItem(UI_THEME_STORAGE_KEY)).toBe('light')
  })
})

describe('readStoredUiTheme', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage())
  })

  afterEach(() => {
    window.localStorage.removeItem(UI_THEME_STORAGE_KEY)
    vi.unstubAllGlobals()
  })

  it('returns light when nothing is stored', () => {
    expect(readStoredUiTheme()).toBe('light')
  })

  it('returns dark when dark is stored', () => {
    window.localStorage.setItem(UI_THEME_STORAGE_KEY, 'dark')
    expect(readStoredUiTheme()).toBe('dark')
  })

  it('normalizes unexpected values to light', () => {
    window.localStorage.setItem(UI_THEME_STORAGE_KEY, 'auto')
    expect(readStoredUiTheme()).toBe('light')
  })
})
