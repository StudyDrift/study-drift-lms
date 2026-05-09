import { useCallback, useEffect, useState } from 'react'
import { fetchOrgRoleCapabilities, type OrgRoleCapabilities } from '../lib/org-roles-api'

export function useOrgRoleCapabilities() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [caps, setCaps] = useState<OrgRoleCapabilities | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const c = await fetchOrgRoleCapabilities()
      setCaps(c)
    } catch (e) {
      setCaps(null)
      setError(e instanceof Error ? e.message : 'Could not load org role capabilities.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return {
    loading,
    error,
    caps,
    reload,
    canManageOrgRoleGrants: caps?.canManageOrgRoleGrants ?? false,
    canListOrgCourseCatalog: caps?.canListOrgCourseCatalog ?? false,
    orgId: caps?.orgId ?? '',
  }
}
