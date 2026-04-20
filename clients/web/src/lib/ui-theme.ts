export type UiTheme = 'light' | 'dark'
export const UI_THEME_STORAGE_KEY = 'lextures.uiTheme'

export function parseUiTheme(raw: string | null | undefined): UiTheme {
  const t = raw?.trim().toLowerCase()
  return t === 'dark' ? 'dark' : 'light'
}

export function readStoredUiTheme(): UiTheme {
  if (typeof window === 'undefined') return 'light'
  try {
    return parseUiTheme(window.localStorage.getItem(UI_THEME_STORAGE_KEY))
  } catch {
    return 'light'
  }
}

/** Applies Tailwind `dark` variant by toggling a class on the document root. */
export function applyUiTheme(theme: UiTheme): void {
  if (typeof document === 'undefined') return
  try {
    window.localStorage.setItem(UI_THEME_STORAGE_KEY, theme)
  } catch {
    /* ignore storage errors */
  }
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
  root.style.colorScheme = theme === 'dark' ? 'dark' : 'light'
}
