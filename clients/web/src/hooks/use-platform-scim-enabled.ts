import { useEffect, useState } from 'react'
import { authorizedFetch } from '../lib/api'

/**
 * Effective platform SCIM flag from GET /api/v1/settings/platform.
 * When fetchEnabled is false, no request runs and scimEnabled stays false.
 */
export function usePlatformScimEnabled(fetchEnabled: boolean): {
  scimEnabled: boolean
  loading: boolean
} {
  const [scimEnabled, setScimEnabled] = useState(false)
  const [loading, setLoading] = useState(fetchEnabled)

  useEffect(() => {
    if (!fetchEnabled) {
      setScimEnabled(false)
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const res = await authorizedFetch('/api/v1/settings/platform')
        const raw: unknown = await res.json().catch(() => ({}))
        if (!cancelled && res.ok) {
          const data = raw as { scimEnabled?: boolean }
          setScimEnabled(data.scimEnabled === true)
        } else if (!cancelled) {
          setScimEnabled(false)
        }
      } catch {
        if (!cancelled) setScimEnabled(false)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [fetchEnabled])

  return { scimEnabled, loading }
}
