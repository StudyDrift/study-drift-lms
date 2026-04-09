import { authorizedFetch } from './api'
import { readApiErrorMessage } from './errors'

/** Server-side guard for Settings → Roles & Permissions APIs; use with `RequirePermission` on the client. */
export const PERM_RBAC_MANAGE = 'global:app:rbac:manage' as const

/** Create new courses (Courses page + POST /api/v1/courses). */
export const PERM_COURSE_CREATE = 'global:app:course:create' as const

/** Learning activity reports (`user.user_audit` aggregates). */
export const PERM_REPORTS_VIEW = 'global:app:reports:view' as const

/** Re-export: per-course item create (`course:<courseCode>:item:create`), merged into `/me/permissions` via course grants. */
export { courseItemCreatePermission as permCourseItemCreate } from './coursesApi'

/** Re-export: view course gradebook (`course:<courseCode>:gradebook:view`). */
export { courseGradebookViewPermission as permCourseGradebookView } from './coursesApi'

export type Permission = {
  id: string
  permissionString: string
  description: string
  createdAt: string
}

export type RoleScope = 'global' | 'course'

export type RoleWithPermissions = {
  id: string
  name: string
  /** Present after API supports role metadata (migration 015). */
  description?: string
  scope?: RoleScope
  createdAt: string
  permissions: Permission[]
}

export type UserBrief = {
  id: string
  email: string
  displayName: string | null
}

async function parseJson(res: Response): Promise<unknown> {
  return res.json().catch(() => ({}))
}

/** Effective permission strings for the signed-in user (from all assigned roles). */
export async function fetchMyPermissionStrings(): Promise<string[]> {
  const res = await authorizedFetch('/api/v1/me/permissions')
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  const data = raw as { permissionStrings?: string[] }
  return data.permissionStrings ?? []
}

export async function fetchPermissions(): Promise<Permission[]> {
  const res = await authorizedFetch('/api/v1/settings/permissions')
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  const data = raw as { permissions?: Permission[] }
  return data.permissions ?? []
}

export async function createPermission(body: {
  permissionString: string
  description: string
}): Promise<Permission> {
  const res = await authorizedFetch('/api/v1/settings/permissions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw as Permission
}

export async function patchPermission(
  id: string,
  body: { description: string },
): Promise<Permission> {
  const res = await authorizedFetch(`/api/v1/settings/permissions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw as Permission
}

export async function deletePermission(id: string): Promise<void> {
  const res = await authorizedFetch(`/api/v1/settings/permissions/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    const raw = await parseJson(res)
    throw new Error(readApiErrorMessage(raw))
  }
}

export async function fetchRoles(): Promise<RoleWithPermissions[]> {
  const res = await authorizedFetch('/api/v1/settings/roles')
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  const data = raw as { roles?: RoleWithPermissions[] }
  return data.roles ?? []
}

export async function createRole(body: {
  name: string
  description?: string
  scope?: RoleScope
}): Promise<RoleWithPermissions> {
  const res = await authorizedFetch('/api/v1/settings/roles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw as RoleWithPermissions
}

export async function patchRole(
  id: string,
  body: { name: string; description: string; scope: RoleScope },
): Promise<void> {
  const res = await authorizedFetch(`/api/v1/settings/roles/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const raw = await parseJson(res)
    throw new Error(readApiErrorMessage(raw))
  }
}

export async function deleteRole(id: string): Promise<void> {
  const res = await authorizedFetch(`/api/v1/settings/roles/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    const raw = await parseJson(res)
    throw new Error(readApiErrorMessage(raw))
  }
}

export async function fetchRoleUsers(roleId: string): Promise<UserBrief[]> {
  const res = await authorizedFetch(`/api/v1/settings/roles/${encodeURIComponent(roleId)}/users`)
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  const data = raw as { users?: UserBrief[] }
  return data.users ?? []
}

export async function fetchEligibleRoleUsers(roleId: string, q?: string): Promise<UserBrief[]> {
  const params = new URLSearchParams()
  if (q?.trim()) params.set('q', q.trim())
  const qs = params.toString()
  const res = await authorizedFetch(
    `/api/v1/settings/roles/${encodeURIComponent(roleId)}/users/eligible${qs ? `?${qs}` : ''}`,
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  const data = raw as { users?: UserBrief[] }
  return data.users ?? []
}

export async function addUserToRole(roleId: string, userId: string): Promise<void> {
  const res = await authorizedFetch(`/api/v1/settings/roles/${encodeURIComponent(roleId)}/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  })
  if (!res.ok) {
    const raw = await parseJson(res)
    throw new Error(readApiErrorMessage(raw))
  }
}

export async function removeUserFromRole(roleId: string, userId: string): Promise<void> {
  const res = await authorizedFetch(
    `/api/v1/settings/roles/${encodeURIComponent(roleId)}/users/${encodeURIComponent(userId)}`,
    { method: 'DELETE' },
  )
  if (!res.ok) {
    const raw = await parseJson(res)
    throw new Error(readApiErrorMessage(raw))
  }
}

export async function setRolePermissions(
  roleId: string,
  permissionIds: string[],
): Promise<RoleWithPermissions> {
  const res = await authorizedFetch(
    `/api/v1/settings/roles/${encodeURIComponent(roleId)}/permissions`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissionIds }),
    },
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw as RoleWithPermissions
}

/** Client-side check; server enforces the same rules. */
export function isValidPermissionString(s: string): boolean {
  const parts = s.trim().split(':')
  if (parts.length !== 4) return false
  return parts.every((p) => p.length > 0)
}
