import { type ReactNode } from 'react'
import { usePermissions } from '../context/usePermissions'

type RequirePermissionProps = {
  /** Required permission string (`scope:area:function:action`). Wildcards supported. */
  permission: string
  children: ReactNode
  /** Rendered while loading effective permissions, or when the user is not allowed. Defaults to nothing. */
  fallback?: ReactNode
}

/**
 * Renders `children` only when the signed-in user has a granted permission that matches `permission`
 * (same matching rules as the server). While permissions are loading, renders `fallback`.
 */
export function RequirePermission({ permission, children, fallback = null }: RequirePermissionProps) {
  const { allows, loading } = usePermissions()
  if (loading) return fallback
  if (!allows(permission)) return fallback
  return <>{children}</>
}
