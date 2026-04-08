import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { getAccessToken } from '../lib/auth'
import { anyGrantMatches } from '../lib/permissionMatch'
import { fetchMyPermissionStrings } from '../lib/rbacApi'

type PermissionsContextValue = {
  permissionStrings: string[]
  loading: boolean
  error: string | null
  allows: (required: string) => boolean
  refresh: () => Promise<void>
}

const PermissionsContext = createContext<PermissionsContextValue | null>(null)

export function PermissionsProvider({ children }: { children: ReactNode }) {
  const [permissionStrings, setPermissionStrings] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const token = getAccessToken()
    if (!token) {
      setPermissionStrings([])
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const list = await fetchMyPermissionStrings()
      setPermissionStrings(list)
    } catch (e) {
      setPermissionStrings([])
      setError(e instanceof Error ? e.message : 'Could not load permissions.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const onAuth = () => void refresh()
    window.addEventListener('studydrift-auth-token', onAuth)
    return () => window.removeEventListener('studydrift-auth-token', onAuth)
  }, [refresh])

  const allows = useCallback(
    (required: string) => anyGrantMatches(permissionStrings, required),
    [permissionStrings],
  )

  const value = useMemo(
    () => ({
      permissionStrings,
      loading,
      error,
      allows,
      refresh,
    }),
    [permissionStrings, loading, error, allows, refresh],
  )

  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>
}

export function usePermissions(): PermissionsContextValue {
  const ctx = useContext(PermissionsContext)
  if (!ctx) {
    throw new Error('usePermissions must be used within PermissionsProvider')
  }
  return ctx
}

/** Returns whether the current user is allowed `permission` (false if still loading or on error). */
export function usePermission(permission: string): boolean {
  const { allows, loading, error } = usePermissions()
  if (loading || error) return false
  return allows(permission)
}
