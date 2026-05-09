import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Plus, RefreshCw, Shield, X } from 'lucide-react'
import { authorizedFetch } from '../../lib/api'
import { readApiErrorMessage } from '../../lib/errors'
import { toastMutationError, toastSaveOk } from '../../lib/lms-toast'
import { usePermissions } from '../../context/use-permissions'
import { decodeJwtPayload } from '../../lib/jwt-payload'
import { getAccessToken } from '../../lib/auth'
import { PERM_TENANT_ORG_ROLES_MANAGE, PERM_TENANT_ORG_ROLES_VIEW } from '../../lib/rbac-api'

type GrantRow = {
  id: string
  orgId: string
  userId: string
  userEmail: string
  displayName: string | null
  orgUnitId: string | null
  orgUnitName: string | null
  role: 'org_admin' | 'org_unit_admin' | 'org_viewer'
  grantedAt: string
  expiresAt: string | null
}

type UserPick = {
  id: string
  email: string
  displayName: string | null
}

type TreeNode = {
  id: string
  name: string
  children: TreeNode[]
}

function flattenUnits(tree: TreeNode[]): Array<{ id: string; name: string }> {
  const out: Array<{ id: string; name: string }> = []
  const walk = (n: TreeNode, prefix: string) => {
    out.push({ id: n.id, name: `${prefix}${n.name}` })
    n.children.forEach((c) => walk(c, `${prefix}— `))
  }
  tree.forEach((n) => walk(n, ''))
  return out
}

export function OrgRolesPanel() {
  const { allows, loading: permLoading } = usePermissions()
  const canView = !permLoading && (allows(PERM_TENANT_ORG_ROLES_VIEW) || allows(PERM_TENANT_ORG_ROLES_MANAGE))
  const canManage = !permLoading && allows(PERM_TENANT_ORG_ROLES_MANAGE)

  const jwtOrgId = decodeJwtPayload(getAccessToken())?.org_id ?? null

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [grants, setGrants] = useState<GrantRow[]>([])

  const [units, setUnits] = useState<Array<{ id: string; name: string }>>([])

  const [modalOpen, setModalOpen] = useState(false)
  const [userQuery, setUserQuery] = useState('')
  const [userResults, setUserResults] = useState<UserPick[]>([])
  const [selectedUser, setSelectedUser] = useState<UserPick | null>(null)
  const [role, setRole] = useState<GrantRow['role']>('org_viewer')
  const [orgUnitId, setOrgUnitId] = useState<string>('')
  const [expiresAt, setExpiresAt] = useState<string>('') // yyyy-mm-dd
  const [saving, setSaving] = useState(false)

  const dialogRef = useRef<HTMLDivElement | null>(null)

  const orgId = jwtOrgId ?? ''

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    setError(null)
    try {
      const [gRes, uRes] = await Promise.all([
        authorizedFetch(`/api/v1/orgs/${encodeURIComponent(orgId)}/role-grants`),
        authorizedFetch(`/api/v1/admin/orgs/${encodeURIComponent(orgId)}/units/tree`),
      ])
      const gRaw: unknown = await gRes.json().catch(() => ({}))
      if (!gRes.ok) throw new Error(readApiErrorMessage(gRaw))
      const data = gRaw as { grants?: GrantRow[] }
      setGrants((data.grants ?? []).map((x) => ({ ...x, displayName: x.displayName ?? null })))

      const uRaw: unknown = await uRes.json().catch(() => ({}))
      if (uRes.ok) {
        const tree = (uRaw as { tree?: TreeNode[] }).tree ?? []
        setUnits(flattenUnits(tree))
      } else {
        setUnits([])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load org roles.')
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    if (canView && orgId) void load()
  }, [canView, orgId, load])

  const visibleGrants = useMemo(() => grants, [grants])

  const searchUsers = useCallback(
    async (q: string) => {
      if (!orgId || q.trim().length < 2) {
        setUserResults([])
        return
      }
      const res = await authorizedFetch(
        `/api/v1/orgs/${encodeURIComponent(orgId)}/users?q=${encodeURIComponent(q.trim())}`,
      )
      const raw: unknown = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(readApiErrorMessage(raw))
      const data = raw as { users?: UserPick[] }
      setUserResults(data.users ?? [])
    },
    [orgId],
  )

  useEffect(() => {
    let cancelled = false
    const q = userQuery
    const t = window.setTimeout(() => {
      if (cancelled) return
      void searchUsers(q).catch(() => {
        if (!cancelled) setUserResults([])
      })
    }, 200)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [userQuery, searchUsers])

  function closeModal() {
    setModalOpen(false)
    setUserQuery('')
    setUserResults([])
    setSelectedUser(null)
    setRole('org_viewer')
    setOrgUnitId('')
    setExpiresAt('')
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!orgId || !selectedUser) return
    if (role === 'org_unit_admin' && !orgUnitId) return
    setSaving(true)
    try {
      const body: {
        user_id: string
        role: GrantRow['role']
        org_unit_id?: string
        expires_at?: string
      } = {
        user_id: selectedUser.id,
        role,
      }
      if (role === 'org_unit_admin') body.org_unit_id = orgUnitId
      if (expiresAt.trim()) {
        body.expires_at = `${expiresAt.trim()}T00:00:00Z`
      }
      const res = await authorizedFetch(`/api/v1/orgs/${encodeURIComponent(orgId)}/role-grants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const raw: unknown = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(readApiErrorMessage(raw))
      toastSaveOk('Role granted.')
      closeModal()
      await load()
    } catch (err) {
      toastMutationError(err instanceof Error ? err.message : 'Request failed.')
    } finally {
      setSaving(false)
    }
  }

  async function revoke(grantId: string) {
    if (!orgId) return
    if (!window.confirm('Revoke this role grant?')) return
    try {
      const res = await authorizedFetch(
        `/api/v1/orgs/${encodeURIComponent(orgId)}/role-grants/${encodeURIComponent(grantId)}`,
        { method: 'DELETE' },
      )
      if (!res.ok) {
        const raw: unknown = await res.json().catch(() => ({}))
        throw new Error(readApiErrorMessage(raw))
      }
      toastSaveOk('Role revoked.')
      await load()
    } catch (err) {
      toastMutationError(err instanceof Error ? err.message : 'Request failed.')
    }
  }

  if (!canView) {
    return (
      <p className="mt-2 text-sm text-slate-600 dark:text-neutral-400">
        You need org admin or org viewer access to view roles.
      </p>
    )
  }

  if (!orgId) {
    return (
      <p className="mt-2 text-sm text-slate-600 dark:text-neutral-400">
        Could not determine your organization.
      </p>
    )
  }

  return (
    <div className="mt-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-slate-600 dark:text-neutral-400">
            Assign org-scoped roles. Org admins can manage units and tenant settings; org viewers can audit role grants.
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-neutral-500">
            Org id <span className="font-mono">{orgId}</span>
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden />
            Refresh
          </button>
          {canManage && (
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
            >
              <Plus className="h-4 w-4" aria-hidden />
              Grant role
            </button>
          )}
        </div>
      </div>

      {error && (
        <p
          className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-200"
          role="alert"
        >
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-slate-500 dark:text-neutral-400">Loading…</p>
      ) : visibleGrants.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center dark:border-neutral-600">
          <Shield className="mx-auto h-8 w-8 opacity-60" aria-hidden />
          <p className="mt-2 text-sm text-slate-700 dark:text-neutral-200">No org role grants yet.</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-neutral-400">
            Assign an org viewer for auditing, or ask a platform admin to bootstrap the first org admin.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-neutral-600">
          <table className="min-w-full divide-y divide-slate-200 text-left text-sm dark:divide-neutral-600" aria-label="Org role grants">
            <thead className="bg-slate-50 dark:bg-neutral-800/80">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium text-slate-700 dark:text-neutral-200">
                  User
                </th>
                <th scope="col" className="px-3 py-2 font-medium text-slate-700 dark:text-neutral-200">
                  Role
                </th>
                <th scope="col" className="px-3 py-2 font-medium text-slate-700 dark:text-neutral-200">
                  Scope
                </th>
                <th scope="col" className="px-3 py-2 font-medium text-slate-700 dark:text-neutral-200">
                  Expires
                </th>
                <th scope="col" className="px-3 py-2 font-medium text-slate-700 dark:text-neutral-200">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white dark:divide-neutral-600 dark:bg-neutral-900">
              {visibleGrants.map((g) => (
                <tr key={g.id} className="hover:bg-slate-50 dark:hover:bg-neutral-800/60">
                  <th scope="row" className="px-3 py-2.5 font-normal text-slate-900 dark:text-neutral-100">
                    <div className="min-w-[220px]">
                      <div className="font-medium">{g.displayName ?? g.userEmail}</div>
                      <div className="text-xs text-slate-500 dark:text-neutral-400">{g.userEmail}</div>
                    </div>
                  </th>
                  <td className="px-3 py-2.5 text-slate-700 dark:text-neutral-200">{g.role}</td>
                  <td className="px-3 py-2.5 text-slate-700 dark:text-neutral-200">
                    {g.orgUnitName ? (
                      <span className="text-xs">{g.orgUnitName}</span>
                    ) : (
                      <span className="text-xs text-slate-400 dark:text-neutral-500">org</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-slate-700 dark:text-neutral-200">
                    {g.expiresAt ? new Date(g.expiresAt).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-3 py-2.5">
                    {canManage ? (
                      <button
                        type="button"
                        onClick={() => void revoke(g.id)}
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-900 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:border-rose-500/50 dark:hover:bg-rose-950/40"
                      >
                        Revoke
                      </button>
                    ) : (
                      <span className="text-xs text-slate-400 dark:text-neutral-500">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label="Grant org role"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal()
          }}
        >
          <div ref={dialogRef} className="w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-neutral-700">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-neutral-100">Grant role</h3>
              <button
                type="button"
                onClick={closeModal}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                aria-label="Close"
                disabled={saving}
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <form onSubmit={onSubmit} className="space-y-4 p-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-neutral-300">
                  User
                  <input
                    value={selectedUser ? selectedUser.email : userQuery}
                    onChange={(e) => {
                      setSelectedUser(null)
                      setUserQuery(e.target.value)
                    }}
                    placeholder="Search by email or name (min 2 chars)"
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-indigo-500/20 focus:border-indigo-400 focus:ring-2 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
                    aria-autocomplete="list"
                    disabled={saving}
                  />
                </label>
                {!selectedUser && userResults.length > 0 && (
                  <ul className="mt-2 max-h-48 overflow-auto rounded-xl border border-slate-200 bg-white text-sm dark:border-neutral-600 dark:bg-neutral-900">
                    {userResults.map((u) => (
                      <li key={u.id}>
                        <button
                          type="button"
                          className="w-full px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-neutral-800"
                          onClick={() => {
                            setSelectedUser(u)
                            setUserResults([])
                          }}
                        >
                          <div className="font-medium text-slate-900 dark:text-neutral-100">
                            {u.displayName ?? u.email}
                          </div>
                          <div className="text-xs text-slate-500 dark:text-neutral-400">{u.email}</div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs font-medium text-slate-700 dark:text-neutral-300">
                  Role
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as GrantRow['role'])}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
                    disabled={saving}
                  >
                    <option value="org_viewer">org_viewer</option>
                    <option value="org_unit_admin">org_unit_admin</option>
                    <option value="org_admin" disabled>
                      org_admin (platform admin only)
                    </option>
                  </select>
                </label>
                <label className="block text-xs font-medium text-slate-700 dark:text-neutral-300">
                  Expires (optional)
                  <input
                    type="date"
                    value={expiresAt}
                    onChange={(e) => setExpiresAt(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
                    disabled={saving}
                  />
                </label>
              </div>

              {role === 'org_unit_admin' && (
                <label className="block text-xs font-medium text-slate-700 dark:text-neutral-300">
                  Org unit scope
                  <select
                    value={orgUnitId}
                    onChange={(e) => setOrgUnitId(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
                    disabled={saving}
                  >
                    <option value="">Select a unit…</option>
                    {units.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-xl px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!selectedUser || saving || (role === 'org_unit_admin' && !orgUnitId)}
                  className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? 'Saving…' : 'Grant'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

