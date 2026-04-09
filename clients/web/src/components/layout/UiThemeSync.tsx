import { useEffect } from 'react'
import { authorizedFetch } from '../../lib/api'
import { applyUiTheme, parseUiTheme } from '../../lib/uiTheme'

/**
 * Loads the signed-in user's persisted UI theme and keeps the document root in sync
 * after account updates.
 */
export function UiThemeSync() {
  useEffect(() => {
    let cancelled = false
    async function sync() {
      try {
        const res = await authorizedFetch('/api/v1/settings/account')
        const raw: unknown = await res.json().catch(() => ({}))
        if (!res.ok || cancelled) return
        const data = raw as { uiTheme?: string }
        applyUiTheme(parseUiTheme(data.uiTheme))
      } catch {
        /* ignore */
      }
    }
    void sync()
    function onProfileUpdated() {
      void sync()
    }
    window.addEventListener('studydrift-profile-updated', onProfileUpdated)
    return () => {
      cancelled = true
      window.removeEventListener('studydrift-profile-updated', onProfileUpdated)
    }
  }, [])

  return null
}
