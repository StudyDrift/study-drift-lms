import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { Shield } from 'lucide-react'
import { ConfirmDialog } from '../confirm-dialog'
import { useOrgRoleCapabilities } from '../../hooks/use-org-role-capabilities'
import {
  deleteOrgRoleGrant,
  fetchOrgRoleGrants,
  postOrgRoleGrant,
  type OrgRoleGrantRow,
} from '../../lib/org-roles-api'
import { PERM_RBAC_MANAGE } from '../../lib/rbac-api'
import { usePermissions } from '../../context/use-permissions'
import { toastMutationError, toastSaveOk } from '../../lib/lms-toast'

const ROLE_OPTIONS_GLOBAL = [
  { value: 'org_admin', label: 'Org admin' },
  { value: 'org_unit_admin', label: 'Org unit admin' },
  { value: 'org_viewer', label: 'Org viewer (read-only catalog)' },
]

const ROLE_OPTIONS_ORG = ROLE_OPTIONS_GLOBAL.filter((o) => o.value !== 'org_admin')

export function OrgRoleGrantsPanel() {
  const { allows, loading: permLoading } = usePermissions()
  const isGlobalAdmin = !permLoading && allows(PERM_RBAC_MANAGE)
  const { orgId, canManageOrgRoleGrants, loading: capsLoading, reload: reloadCaps } =
    useOrgRoleCapabilities()
  const [grants, setGrants] = useState<OrgRoleGrantRow[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadingGrants, setLoadingGrants] = useState(false)
  const [userId, setUserId] = useState('')
  const [role, setRole] = useState('org_unit_admin')
  const [orgUnitId, setOrgUnitId] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [saving, setSaving] = useState(false)
  const [revokeId, setRevokeId] = useState<string | null>(null)
  const [revokeBusy, setRevokeBusy] = useState(false)

  const roleChoices = useMemo(() => (isGlobalAdmin ? ROLE_OPTIONS_GLOBAL : ROLE_OPTIONS_ORG), [isGlobalAdmin])

  const loadGrants = useCallback(async () => {
    if (!orgId || !canManageOrgRoleGrants) return
    setLoadingGrants(true)
    setLoadError(null)
    try {
      const list = await fetchOrgRoleGrants(orgId)
      setGrants(list)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load org role grants.')
      setGrants([])
    } finally {
      setLoadingGrants(false)
    }
  }, [orgId, canManageOrgRoleGrants])

  useEffect(() => {
    void loadGrants()
  }, [loadGrants])

  useEffect(() => {
    if (role !== 'org_unit_admin' && orgUnitId) {
      setOrgUnitId('')
    }
  }, [role, orgUnitId])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!orgId) return
    const uid = userId.trim()
    if (!uid) {
      toastMutationError('Enter a user id.')
      return
    }
    setSaving(true)
    try {
      await postOrgRoleGrant(orgId, {
        userId: uid,
        role,
        orgUnitId: role === 'org_unit_admin' ? orgUnitId.trim() || undefined : undefined,
        expiresAt: expiresAt.trim() || undefined,
      })
      toastSaveOk('Role grant saved')
      setUserId('')
      setOrgUnitId('')
      setExpiresAt('')
      await loadGrants()
      await reloadCaps()
    } catch (err) {
      toastMutationError(err instanceof Error ? err.message : 'Could not save grant.')
    } finally {
      setSaving(false)
    }
  }

  async function onConfirmRevoke() {
    if (!orgId || !revokeId) return
    setRevokeBusy(true)
    try {
      await deleteOrgRoleGrant(orgId, revokeId)
      toastSaveOk('Grant revoked')
      setRevokeId(null)
      await loadGrants()
      await reloadCaps()
    } catch (e) {
      toastMutationError(e instanceof Error ? e.message : 'Could not revoke.')
    } finally {
      setRevokeBusy(false)
    }
  }

  if (capsLoading) {
    return (
      <p className="mt-4 text-sm text-slate-500 dark:text-neutral-400" aria-busy="true">
        Loading…
      </p>
    )
  }

  if (!canManageOrgRoleGrants) {
    return (
      <p className="mt-6 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-neutral-600 dark:bg-neutral-800/50 dark:text-neutral-300">
        You do not have permission to manage organization role grants. An organization administrator or
        platform administrator can assign these roles.
      </p>
    )
  }

  return (
    <div className="mt-4 space-y-8">
      <div>
        <h3 className="text-sm font-semibold text-slate-900 dark:text-neutral-100">Assign role</h3>
        <p className="mt-1 text-xs text-slate-500 dark:text-neutral-400">
          Org admins can assign unit admins and viewers. Only a platform administrator can assign the
          organization admin role.
        </p>
        <form className="mt-4 space-y-3" onSubmit={onSubmit}>
          <div>
            <label htmlFor="org-role-user-id" className="block text-xs font-medium text-slate-700 dark:text-neutral-300">
              User id
            </label>
            <input
              id="org-role-user-id"
              type="text"
              value={userId}
              onChange={(ev) => setUserId(ev.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
              autoComplete="off"
              placeholder="UUID of the user in your organization"
            />
          </div>
          <div>
            <label htmlFor="org-role-select" className="block text-xs font-medium text-slate-700 dark:text-neutral-300">
              Role
            </label>
            <select
              id="org-role-select"
              value={role}
              onChange={(ev) => setRole(ev.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
            >
              {roleChoices.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          {role === 'org_unit_admin' && (
            <div>
              <label htmlFor="org-role-unit-id" className="block text-xs font-medium text-slate-700 dark:text-neutral-300">
                Org unit id
              </label>
              <input
                id="org-role-unit-id"
                type="text"
                value={orgUnitId}
                onChange={(ev) => setOrgUnitId(ev.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
                autoComplete="off"
                placeholder="UUID of the school or department root unit"
              />
            </div>
          )}
          <div>
            <label htmlFor="org-role-expires" className="block text-xs font-medium text-slate-700 dark:text-neutral-300">
              Expires (optional, RFC3339)
            </label>
            <input
              id="org-role-expires"
              type="text"
              value={expiresAt}
              onChange={(ev) => setExpiresAt(ev.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
              autoComplete="off"
              placeholder="e.g. 2027-01-01T00:00:00Z"
            />
          </div>
          <button
            type="submit"
            disabled={saving}
            className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-950 dark:hover:bg-white"
          >
            {saving ? 'Saving…' : 'Save grant'}
          </button>
        </form>
      </div>

      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-neutral-100">
          <Shield className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
          Current grants
        </h3>
        {loadError && (
          <p className="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-500/40 dark:bg-rose-950/40 dark:text-rose-100">
            {loadError}
          </p>
        )}
        {loadingGrants && <p className="mt-3 text-sm text-slate-500 dark:text-neutral-400">Loading grants…</p>}
        {!loadingGrants && grants.length === 0 && !loadError && (
          <p className="mt-3 text-sm text-slate-600 dark:text-neutral-300">
            No org role grants yet. Assign an org admin (platform) or unit roles so your institution can
            self-manage users and courses.
          </p>
        )}
        {grants.length > 0 && (
          <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 dark:border-neutral-600">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm dark:divide-neutral-600">
              <thead className="bg-slate-50 dark:bg-neutral-800/80">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium text-slate-700 dark:text-neutral-200">
                    User
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium text-slate-700 dark:text-neutral-200">
                    Role
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium text-slate-700 dark:text-neutral-200">
                    Unit
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium text-slate-700 dark:text-neutral-200">
                    Expires
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium text-slate-700 dark:text-neutral-200">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white dark:divide-neutral-700 dark:bg-neutral-900">
                {grants.map((g) => (
                  <tr key={g.id}>
                    <td className="px-3 py-2 font-mono text-xs text-slate-800 dark:text-neutral-100">{g.userId}</td>
                    <td className="px-3 py-2 text-slate-800 dark:text-neutral-100">{g.role}</td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-600 dark:text-neutral-300">
                      {g.orgUnitId ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600 dark:text-neutral-300">{g.expiresAt ?? '—'}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50 dark:border-neutral-600 dark:text-rose-300 dark:hover:bg-rose-950/40"
                        onClick={() => setRevokeId(g.id)}
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={revokeId !== null}
        title="Revoke organization role?"
        description="This user will lose elevated access immediately."
        variant="danger"
        confirmLabel="Revoke"
        busy={revokeBusy}
        onClose={() => {
          if (!revokeBusy) setRevokeId(null)
        }}
        onConfirm={() => void onConfirmRevoke()}
      />
    </div>
  )
}
