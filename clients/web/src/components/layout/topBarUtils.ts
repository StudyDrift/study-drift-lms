export type TopBarAccountProfile = {
  email: string
  displayName?: string | null
  firstName?: string | null
  lastName?: string | null
  avatarUrl?: string | null
}

export function profileName(profile: TopBarAccountProfile | null): string {
  if (!profile) return 'Profile'
  const first = profile.firstName?.trim() ?? ''
  const last = profile.lastName?.trim() ?? ''
  const combined = [first, last].filter(Boolean).join(' ').trim()
  if (combined) return combined
  const display = profile.displayName?.trim() ?? ''
  if (display) return display
  return profile.email
}

export function initialsFromName(name: string): string {
  const parts = name
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (parts.length === 0) return 'U'
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase()
  return `${parts[0].slice(0, 1)}${parts[1].slice(0, 1)}`.toUpperCase()
}

/** Keyboard hint for opening the command palette (⌘K vs Ctrl+K). */
export function shortcutHint(): string {
  if (typeof navigator === 'undefined') return '⌘K'
  const p = navigator.platform ?? ''
  const ua = navigator.userAgent ?? ''
  const apple = /Mac|iPhone|iPad|iPod/.test(p) || /Mac OS/.test(ua)
  return apple ? '⌘K' : 'Ctrl+K'
}
