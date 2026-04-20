import { useContext } from 'react'
import { PermissionsContext, type PermissionsContextValue } from './permissions-context'

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
