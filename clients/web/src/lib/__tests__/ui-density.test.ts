import { describe, expect, it } from 'vitest'
import { applyUiDensityToDocument, readStoredUiDensity, UI_DENSITY_STORAGE_KEY } from '../ui-density'

describe('ui-density', () => {
  const storage = new Map<string, string>()
  const localStorageMock = {
    getItem: (k: string) => (storage.has(k) ? storage.get(k)! : null),
    setItem: (k: string, v: string) => {
      storage.set(k, String(v))
    },
    removeItem: (k: string) => {
      storage.delete(k)
    },
  }
  Object.defineProperty(window, 'localStorage', { value: localStorageMock, configurable: true })

  it('defaults to comfortable when storage is empty or invalid', () => {
    storage.clear()
    window.localStorage.removeItem(UI_DENSITY_STORAGE_KEY)
    expect(readStoredUiDensity()).toBe('comfortable')

    window.localStorage.setItem(UI_DENSITY_STORAGE_KEY, 'invalid')
    expect(readStoredUiDensity()).toBe('comfortable')
  })

  it('reads compact and applies density to document + localStorage', () => {
    window.localStorage.setItem(UI_DENSITY_STORAGE_KEY, 'compact')
    expect(readStoredUiDensity()).toBe('compact')

    applyUiDensityToDocument('compact')
    expect(document.documentElement.dataset.lmsDensity).toBe('compact')
    expect(window.localStorage.getItem(UI_DENSITY_STORAGE_KEY)).toBe('compact')
  })
})
