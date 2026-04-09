export type UiTheme = 'light' | 'dark'

export function parseUiTheme(raw: string | null | undefined): UiTheme {
  const t = raw?.trim().toLowerCase()
  return t === 'dark' ? 'dark' : 'light'
}

/** Applies Tailwind `dark` variant by toggling a class on the document root. */
export function applyUiTheme(theme: UiTheme): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
  root.style.colorScheme = theme === 'dark' ? 'dark' : 'light'
}
