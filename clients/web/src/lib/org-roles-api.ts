import { authorizedFetch } from './api'
import { readApiErrorMessage } from './errors'

export type OrgRoleCapabilities = {
  orgId: string
  canManageOrgRoleGrants: boolean
  canListOrgCourseCatalog: boolean
}

export type OrgRoleGrantRow = {
  id: string
  orgId: string
  userId: string
  role: string
  orgUnitId: string | null
  grantedBy: string
  grantedAt: string
  expiresAt: string | null
}

async function parseJson(res: Response): Promise<unknown> {
  return res.json().catch(() => ({}))
}

export async function fetchOrgRoleCapabilities(): Promise<OrgRoleCapabilities> {
  const res = await authorizedFetch('/api/v1/me/org-role-capabilities')
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  const data = raw as {
    orgId?: string
    canManageOrgRoleGrants?: boolean
    canListOrgCourseCatalog?: boolean
  }
  return {
    orgId: data.orgId ?? '',
    canManageOrgRoleGrants: Boolean(data.canManageOrgRoleGrants),
    canListOrgCourseCatalog: Boolean(data.canListOrgCourseCatalog),
  }
}

export async function fetchOrgRoleGrants(orgId: string): Promise<OrgRoleGrantRow[]> {
  const res = await authorizedFetch(`/api/v1/orgs/${encodeURIComponent(orgId)}/role-grants`)
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  const data = raw as { grants?: OrgRoleGrantRow[] }
  return data.grants ?? []
}

export async function postOrgRoleGrant(
  orgId: string,
  body: { userId: string; role: string; orgUnitId?: string; expiresAt?: string },
): Promise<void> {
  const res = await authorizedFetch(`/api/v1/orgs/${encodeURIComponent(orgId)}/role-grants`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: body.userId,
      role: body.role,
      orgUnitId: body.orgUnitId,
      expiresAt: body.expiresAt,
    }),
  })
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
}

export async function deleteOrgRoleGrant(orgId: string, grantId: string): Promise<void> {
  const res = await authorizedFetch(
    `/api/v1/orgs/${encodeURIComponent(orgId)}/role-grants/${encodeURIComponent(grantId)}`,
    { method: 'DELETE' },
  )
  if (!res.ok) {
    const raw = await parseJson(res)
    throw new Error(readApiErrorMessage(raw))
  }
}
