const SESSION_KEY = 'lextures-post-login-shortcut-tip'
const DISMISS_KEY = 'lextures-search-shortcut-tip-dismissed'

/** Call after successful sign-in so the LMS shell can show the search shortcut tip once. */
export function markPostLoginShortcutTip(): void {
  try {
    sessionStorage.setItem(SESSION_KEY, '1')
  } catch {
    /* quota / private mode */
  }
}

export function isPostLoginShortcutTipPending(): boolean {
  try {
    return sessionStorage.getItem(SESSION_KEY) === '1'
  } catch {
    return false
  }
}

export function isSearchShortcutTipDismissedPermanently(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return true
  }
}

export function dismissSearchShortcutTip(): void {
  try {
    localStorage.setItem(DISMISS_KEY, '1')
    sessionStorage.removeItem(SESSION_KEY)
  } catch {
    /* ignore */
  }
}
