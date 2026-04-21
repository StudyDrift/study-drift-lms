export type UiDensity = 'comfortable' | 'compact'

export const UI_DENSITY_STORAGE_KEY = 'lextures.uiDensity'

export function readStoredUiDensity(): UiDensity {
  if (typeof window === 'undefined') return 'comfortable'
  try {
    const v = window.localStorage.getItem(UI_DENSITY_STORAGE_KEY)?.trim().toLowerCase()
    return v === 'compact' ? 'compact' : 'comfortable'
  } catch {
    return 'comfortable'
  }
}

export function applyUiDensityToDocument(density: UiDensity): void {
  if (typeof document === 'undefined') return
  try {
    window.localStorage.setItem(UI_DENSITY_STORAGE_KEY, density)
  } catch {
    /* ignore */
  }
  document.documentElement.dataset.lmsDensity = density
}
