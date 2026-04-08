import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Plus, Settings, Trash2, Users, X } from 'lucide-react'
import {
  addUserToRole,
  createPermission,
  createRole,
  deletePermission,
  deleteRole,
  fetchEligibleRoleUsers,
  fetchPermissions,
  fetchRoleUsers,
  fetchRoles,
  isValidPermissionString,
  patchPermission,
  patchRole,
  removeUserFromRole,
  setRolePermissions,
  type Permission,
  type RoleScope,
  type RoleWithPermissions,
  type UserBrief,
} from '../../lib/rbacApi'

export function RolesPermissionsPanel() {
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [roles, setRoles] = useState<RoleWithPermissions[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [newPermStr, setNewPermStr] = useState('')
  const [newPermDesc, setNewPermDesc] = useState('')
  const [newRoleName, setNewRoleName] = useState('')
  const [creating, setCreating] = useState(false)

  const [expandedRoleId, setExpandedRoleId] = useState<string | null>(null)
  const [draftPermIds, setDraftPermIds] = useState<Set<string>>(new Set())
  const [savingRolePerms, setSavingRolePerms] = useState(false)

  const [roleSettingsModal, setRoleSettingsModal] = useState<RoleWithPermissions | null>(null)

  const [addModalRoleId, setAddModalRoleId] = useState<string | null>(null)
  const [addModalFilter, setAddModalFilter] = useState('')
  const [addModalSelected, setAddModalSelected] = useState<Set<string>>(new Set())

  const [manageUsersModal, setManageUsersModal] = useState<{ roleId: string; roleName: string } | null>(
    null,
  )

  const loadAll = useCallback(async () => {
    setError(null)
    try {
      const [p, r] = await Promise.all([fetchPermissions(), fetchRoles()])
      setPermissions(p)
      setRoles(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load roles and permissions.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  useEffect(() => {
    if (!expandedRoleId) {
      setDraftPermIds(new Set())
      return
    }
    const role = roles.find((x) => x.id === expandedRoleId)
    if (role) {
      setDraftPermIds(new Set(role.permissions.map((p) => p.id)))
    }
  }, [expandedRoleId, roles])

  async function onCreatePermission(e: FormEvent) {
    e.preventDefault()
    const s = newPermStr.trim()
    if (!isValidPermissionString(s)) {
      setError('Use exactly four segments: scope:area:function:action (each part non-empty; use * for wildcards).')
      return
    }
    setCreating(true)
    setError(null)
    try {
      await createPermission({ permissionString: s, description: newPermDesc.trim() })
      setNewPermStr('')
      setNewPermDesc('')
      await loadAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create permission.')
    } finally {
      setCreating(false)
    }
  }

  async function onSaveDescription(id: string, description: string) {
    setError(null)
    try {
      await patchPermission(id, { description })
      await loadAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update description.')
    }
  }

  async function onDeletePermission(id: string) {
    if (!window.confirm('Delete this permission? It will be removed from all roles.')) return
    setError(null)
    try {
      await deletePermission(id)
      await loadAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete permission.')
    }
  }

  async function onCreateRole(e: FormEvent) {
    e.preventDefault()
    const name = newRoleName.trim()
    if (!name) return
    setCreating(true)
    setError(null)
    try {
      await createRole({ name })
      setNewRoleName('')
      await loadAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create role.')
    } finally {
      setCreating(false)
    }
  }

  async function onDeleteRole(id: string) {
    if (!window.confirm('Delete this role?')) return
    setError(null)
    try {
      await deleteRole(id)
      if (expandedRoleId === id) setExpandedRoleId(null)
      await loadAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete role.')
    }
  }

  async function persistRolePermissions(roleId: string, ids: Set<string>) {
    setSavingRolePerms(true)
    setError(null)
    try {
      const updated = await setRolePermissions(roleId, [...ids])
      setRoles((prev) => prev.map((r) => (r.id === roleId ? updated : r)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save role permissions.')
    } finally {
      setSavingRolePerms(false)
    }
  }

  async function removePermissionFromRole(roleId: string, permissionId: string) {
    const next = new Set(draftPermIds)
    next.delete(permissionId)
    await persistRolePermissions(roleId, next)
  }

  function openAddModal(roleId: string) {
    setAddModalRoleId(roleId)
    setAddModalFilter('')
    setAddModalSelected(new Set())
  }

  function closeAddModal() {
    setAddModalRoleId(null)
    setAddModalFilter('')
    setAddModalSelected(new Set())
  }

  function toggleModalSelect(pid: string) {
    setAddModalSelected((prev) => {
      const next = new Set(prev)
      if (next.has(pid)) next.delete(pid)
      else next.add(pid)
      return next
    })
  }

  async function applyModalAdds() {
    if (!addModalRoleId) {
      closeAddModal()
      return
    }
    if (addModalSelected.size === 0) {
      closeAddModal()
      return
    }
    const roleId = addModalRoleId
    const next = new Set(draftPermIds)
    for (const id of addModalSelected) next.add(id)
    await persistRolePermissions(roleId, next)
    closeAddModal()
  }

  if (loading) {
    return <p className="mt-4 text-sm text-slate-500">Loading roles and permissions…</p>
  }

  return (
    <div className="mt-6 space-y-10">
      {error && (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">
          {error}
        </p>
      )}

      <section>
        <h3 className="text-sm font-semibold text-slate-900">Permission strings</h3>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Each permission uses{' '}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">scope:area:function:action</code>
          . Use <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">*</code> in any segment
          for a wildcard (for example{' '}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">course:*:enrollments:*</code>
          ).
        </p>

        <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Permission</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3 w-28"> </th>
              </tr>
            </thead>
            <tbody>
              {permissions.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-slate-500">
                    No permissions yet. Add one below.
                  </td>
                </tr>
              )}
              {permissions.map((p) => (
                <PermissionRow
                  key={p.id}
                  permission={p}
                  onSaveDescription={onSaveDescription}
                  onDelete={() => void onDeletePermission(p.id)}
                />
              ))}
            </tbody>
          </table>
        </div>

        <form onSubmit={(e) => void onCreatePermission(e)} className="mt-4 flex flex-col gap-3 rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-4 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="min-w-0 flex-1">
            <label htmlFor="new-perm-string" className="text-xs font-medium text-slate-600">
              Permission string
            </label>
            <input
              id="new-perm-string"
              value={newPermStr}
              onChange={(e) => setNewPermStr(e.target.value)}
              placeholder="course:*:enrollments:create"
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 shadow-sm outline-none ring-indigo-500/0 transition focus:border-indigo-300 focus:ring-2"
            />
          </div>
          <div className="min-w-0 flex-1">
            <label htmlFor="new-perm-desc" className="text-xs font-medium text-slate-600">
              Description
            </label>
            <input
              id="new-perm-desc"
              value={newPermDesc}
              onChange={(e) => setNewPermDesc(e.target.value)}
              placeholder="Create enrollments in any course"
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none ring-indigo-500/0 transition focus:border-indigo-300 focus:ring-2"
            />
          </div>
          <button
            type="submit"
            disabled={creating}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Add permission
          </button>
        </form>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-slate-900">Roles</h3>
        <p className="mt-1 text-sm text-slate-500">
          Each role holds a set of permissions. Assign or remove permissions below; nothing is enforced in the app
          until you wire checks in code.
        </p>

        <form onSubmit={(e) => void onCreateRole(e)} className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <label htmlFor="new-role-name" className="text-xs font-medium text-slate-600">
              New role name
            </label>
            <input
              id="new-role-name"
              value={newRoleName}
              onChange={(e) => setNewRoleName(e.target.value)}
              placeholder="e.g. Department admin"
              className="mt-1 w-full max-w-md rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none ring-indigo-500/0 transition focus:border-indigo-300 focus:ring-2"
            />
          </div>
          <button
            type="submit"
            disabled={creating || !newRoleName.trim()}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-900 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Add role
          </button>
        </form>

        <div className="mt-4 space-y-2">
          {roles.map((role) => {
            const expanded = expandedRoleId === role.id
            return (
              <div
                key={role.id}
                className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
              >
                <div className="flex flex-wrap items-center gap-2 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => setExpandedRoleId(expanded ? null : role.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-medium text-slate-900"
                    aria-expanded={expanded}
                  >
                    {expanded ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
                    )}
                    <span className="truncate">{role.name}</span>
                    <span
                      className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                        (role.scope ?? 'global') === 'course'
                          ? 'bg-violet-100 text-violet-800'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {(role.scope ?? 'global') === 'course' ? 'Course' : 'Global'}
                    </span>
                    <span className="font-normal text-slate-500">
                      ({role.permissions.length} permission{role.permissions.length === 1 ? '' : 's'})
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setRoleSettingsModal(role)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 shadow-sm transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-900"
                  >
                    <Settings className="h-3.5 w-3.5" aria-hidden />
                    Settings
                  </button>
                  <button
                    type="button"
                    onClick={() => void onDeleteRole(role.id)}
                    className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-700"
                    aria-label={`Delete role ${role.name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                {expanded && (
                  <div className="border-t border-slate-100 bg-slate-50/80 px-4 py-4">
                    {role.description?.trim() ? (
                      <p className="mb-3 text-sm text-slate-600">{role.description.trim()}</p>
                    ) : null}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-medium text-slate-600">Assigned permissions</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setManageUsersModal({ roleId: role.id, roleName: role.name })}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-sm transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-900"
                        >
                          <Users className="h-3.5 w-3.5" aria-hidden />
                          Manage Users
                        </button>
                        <button
                          type="button"
                          onClick={() => openAddModal(role.id)}
                          disabled={permissions.length === 0 || savingRolePerms}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-sm transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-900 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Plus className="h-3.5 w-3.5" aria-hidden />
                          Add
                        </button>
                      </div>
                    </div>
                    {permissions.length === 0 ? (
                      <p className="mt-2 text-sm text-slate-500">Create permissions above first.</p>
                    ) : (
                      <AssignedPermissionsList
                        assigned={permissions
                          .filter((p) => draftPermIds.has(p.id))
                          .sort((a, b) => a.permissionString.localeCompare(b.permissionString))}
                        onRemove={(pid) => void removePermissionFromRole(role.id, pid)}
                        saving={savingRolePerms}
                      />
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      {addModalRoleId && (
        <AddPermissionsModal
          allPermissions={permissions}
          assignedIds={draftPermIds}
          filter={addModalFilter}
          onFilterChange={setAddModalFilter}
          selectedIds={addModalSelected}
          onToggleSelect={toggleModalSelect}
          onClose={closeAddModal}
          onConfirm={() => void applyModalAdds()}
          saving={savingRolePerms}
        />
      )}

      {roleSettingsModal && (
        <RoleSettingsModal
          role={roleSettingsModal}
          onClose={() => setRoleSettingsModal(null)}
          onSaved={() => void loadAll()}
        />
      )}

      {manageUsersModal && (
        <ManageUsersModal
          roleId={manageUsersModal.roleId}
          roleName={manageUsersModal.roleName}
          onClose={() => setManageUsersModal(null)}
        />
      )}
    </div>
  )
}

type RoleSettingsModalProps = {
  role: RoleWithPermissions
  onClose: () => void
  onSaved: () => void
}

function RoleSettingsModal({ role, onClose, onSaved }: RoleSettingsModalProps) {
  const [name, setName] = useState(role.name)
  const [description, setDescription] = useState(role.description ?? '')
  const [scope, setScope] = useState<RoleScope>(role.scope === 'course' ? 'course' : 'global')
  const [saving, setSaving] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  useEffect(() => {
    setName(role.name)
    setDescription(role.description ?? '')
    setScope(role.scope === 'course' ? 'course' : 'global')
  }, [role])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const n = name.trim()
    if (!n) {
      setLocalError('Name is required.')
      return
    }
    setSaving(true)
    setLocalError(null)
    try {
      await patchRole(role.id, {
        name: n,
        description: description.trim(),
        scope,
      })
      onSaved()
      onClose()
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Could not save role.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="role-settings-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h3 id="role-settings-title" className="text-sm font-semibold text-slate-900">
            Role settings
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={(e) => void onSubmit(e)} className="px-4 py-4">
          <div className="space-y-4">
            <div>
              <label htmlFor="role-settings-name" className="text-xs font-medium text-slate-600">
                Name
              </label>
              <input
                id="role-settings-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm outline-none ring-indigo-500/0 transition focus:border-indigo-300 focus:ring-2"
                autoComplete="off"
                disabled={saving}
              />
            </div>
            <div>
              <label htmlFor="role-settings-desc" className="text-xs font-medium text-slate-600">
                Description
              </label>
              <textarea
                id="role-settings-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="What this role is for (shown only in Settings)."
                className="mt-1 w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm outline-none ring-indigo-500/0 transition focus:border-indigo-300 focus:ring-2"
                disabled={saving}
              />
            </div>
            <div>
              <span id="role-settings-scope-label" className="text-xs font-medium text-slate-600">
                Scope
              </span>
              <p className="mt-1 text-xs text-slate-500">
                Global roles are assigned to users in Settings. Course roles are intended for
                per-course assignment (e.g. teachers for one course); the app may still use them in
                global assignments if you choose.
              </p>
              <select
                id="role-settings-scope"
                aria-labelledby="role-settings-scope-label"
                value={scope}
                onChange={(e) => setScope(e.target.value as RoleScope)}
                className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none ring-indigo-500/0 transition focus:border-indigo-300 focus:ring-2"
                disabled={saving}
              >
                <option value="global">Global</option>
                <option value="course">Course</option>
              </select>
            </div>
          </div>
          {localError && (
            <p className="mt-3 text-sm text-rose-700" role="alert">
              {localError}
            </p>
          )}
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

type AssignedPermissionsListProps = {
  assigned: Permission[]
  onRemove: (permissionId: string) => void
  saving: boolean
}

function AssignedPermissionsList({ assigned, onRemove, saving }: AssignedPermissionsListProps) {
  if (assigned.length === 0) {
    return (
      <p className="mt-3 text-sm text-slate-500">
        No permissions assigned yet. Use <span className="font-medium">Add</span> to choose some.
      </p>
    )
  }
  return (
    <ul className="mt-3 space-y-2">
      {assigned.map((p) => (
        <li
          key={p.id}
          className="flex items-start gap-3 rounded-lg border border-slate-100 bg-white px-3 py-2.5 shadow-sm"
        >
          <button
            type="button"
            onClick={() => onRemove(p.id)}
            disabled={saving}
            className="mt-0.5 shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={`Remove ${p.permissionString} from role`}
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
          <div className="min-w-0 flex-1 text-sm">
            <span className="font-mono text-xs text-slate-900">{p.permissionString}</span>
            {p.description ? (
              <span className="mt-0.5 block text-slate-500">{p.description}</span>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  )
}

type AddPermissionsModalProps = {
  allPermissions: Permission[]
  assignedIds: Set<string>
  filter: string
  onFilterChange: (v: string) => void
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onClose: () => void
  onConfirm: () => void
  saving: boolean
}

function AddPermissionsModal({
  allPermissions,
  assignedIds,
  filter,
  onFilterChange,
  selectedIds,
  onToggleSelect,
  onClose,
  onConfirm,
  saving,
}: AddPermissionsModalProps) {
  const q = filter.trim().toLowerCase()
  const available = useMemo(() => {
    return allPermissions
      .filter((p) => !assignedIds.has(p.id))
      .filter((p) => {
        if (!q) return true
        return (
          p.permissionString.toLowerCase().includes(q) ||
          (p.description && p.description.toLowerCase().includes(q))
        )
      })
      .sort((a, b) => a.permissionString.localeCompare(b.permissionString))
  }, [allPermissions, assignedIds, q])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-permissions-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="flex max-h-[min(90vh,560px)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h3 id="add-permissions-title" className="text-sm font-semibold text-slate-900">
            Add permissions
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="border-b border-slate-100 px-4 py-3">
          <label htmlFor="add-perm-filter" className="sr-only">
            Filter permissions
          </label>
          <input
            id="add-perm-filter"
            type="search"
            value={filter}
            onChange={(e) => onFilterChange(e.target.value)}
            placeholder="Filter by permission or description…"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm outline-none ring-indigo-500/0 transition focus:border-indigo-300 focus:ring-2"
            autoFocus
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {available.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-slate-500">
              {allPermissions.length === 0
                ? 'No permissions exist yet. Create some in the table above.'
                : assignedIds.size >= allPermissions.length
                  ? 'This role already has every permission.'
                  : 'No permissions match your filter.'}
            </p>
          ) : (
            <ul className="space-y-1">
              {available.map((p) => (
                <li key={p.id}>
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2 hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(p.id)}
                      disabled={saving}
                      onChange={() => onToggleSelect(p.id)}
                      className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-50"
                    />
                    <span className="min-w-0 flex-1 text-sm">
                      <span className="font-mono text-xs text-slate-900">{p.permissionString}</span>
                      {p.description ? (
                        <span className="mt-0.5 block text-slate-500">{p.description}</span>
                      ) : null}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving || selectedIds.size === 0}
            onClick={onConfirm}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? 'Saving…' : `Add${selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}

type ManageUsersModalProps = {
  roleId: string
  roleName: string
  onClose: () => void
}

function ManageUsersModal({ roleId, roleName, onClose }: ManageUsersModalProps) {
  const [members, setMembers] = useState<UserBrief[]>([])
  const [eligible, setEligible] = useState<UserBrief[]>([])
  const [memberFilter, setMemberFilter] = useState('')
  const [eligibleFilter, setEligibleFilter] = useState('')
  const [loadingMembers, setLoadingMembers] = useState(true)
  const [eligibleLoading, setEligibleLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoadingMembers(true)
      setError(null)
      try {
        const list = await fetchRoleUsers(roleId)
        if (!cancelled) setMembers(list)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load members.')
      } finally {
        if (!cancelled) setLoadingMembers(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [roleId])

  useEffect(() => {
    const debounceMs = eligibleFilter.trim() ? 300 : 0
    let cancelled = false
    const t = window.setTimeout(() => {
      void (async () => {
        setEligibleLoading(true)
        setError(null)
        try {
          const list = await fetchEligibleRoleUsers(roleId, eligibleFilter.trim() || undefined)
          if (!cancelled) setEligible(list)
        } catch (e) {
          if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load users.')
        } finally {
          if (!cancelled) setEligibleLoading(false)
        }
      })()
    }, debounceMs)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [roleId, eligibleFilter])

  async function reloadBoth() {
    const [m, e] = await Promise.all([
      fetchRoleUsers(roleId),
      fetchEligibleRoleUsers(roleId, eligibleFilter.trim() || undefined),
    ])
    setMembers(m)
    setEligible(e)
  }

  async function handleRemove(userId: string) {
    setBusyId(userId)
    setError(null)
    try {
      await removeUserFromRole(roleId, userId)
      await reloadBoth()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove user.')
    } finally {
      setBusyId(null)
    }
  }

  async function handleAdd(userId: string) {
    setBusyId(userId)
    setError(null)
    try {
      await addUserToRole(roleId, userId)
      await reloadBoth()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add user.')
    } finally {
      setBusyId(null)
    }
  }

  const filteredMembers = useMemo(() => {
    const q = memberFilter.trim().toLowerCase()
    if (!q) return members
    return members.filter(
      (u) =>
        u.email.toLowerCase().includes(q) ||
        (u.displayName && u.displayName.toLowerCase().includes(q)),
    )
  }, [members, memberFilter])

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="manage-users-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="flex max-h-[min(92vh,640px)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h3 id="manage-users-title" className="text-sm font-semibold text-slate-900">
            Manage users — {roleName}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {error && (
            <p className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              {error}
            </p>
          )}

          <section>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Users in role</p>
            <label htmlFor="member-filter" className="sr-only">
              Filter members
            </label>
            <input
              id="member-filter"
              type="search"
              value={memberFilter}
              onChange={(e) => setMemberFilter(e.target.value)}
              placeholder="Filter by name or email…"
              className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-500/30"
            />
            {loadingMembers ? (
              <p className="mt-3 text-sm text-slate-500">Loading…</p>
            ) : filteredMembers.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">
                {members.length === 0 ? 'No users assigned to this role yet.' : 'No users match this filter.'}
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {filteredMembers.map((u) => (
                  <li
                    key={u.id}
                    className="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2.5"
                  >
                    <button
                      type="button"
                      onClick={() => void handleRemove(u.id)}
                      disabled={busyId === u.id}
                      className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
                      aria-label={`Remove ${u.email} from role`}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                    <div className="min-w-0 flex-1 text-sm">
                      <div className="truncate font-medium text-slate-900">
                        {u.displayName?.trim() || u.email}
                      </div>
                      {u.displayName?.trim() ? (
                        <div className="truncate text-xs text-slate-500">{u.email}</div>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="mt-8 border-t border-slate-100 pt-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Add users</p>
            <p className="mt-1 text-xs text-slate-500">
              Search users who do not have this role yet, then add them.
            </p>
            <label htmlFor="eligible-filter" className="sr-only">
              Filter users to add
            </label>
            <input
              id="eligible-filter"
              type="search"
              value={eligibleFilter}
              onChange={(e) => setEligibleFilter(e.target.value)}
              placeholder="Filter by name or email…"
              className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-500/30"
            />
            {eligibleLoading ? (
              <p className="mt-3 text-sm text-slate-500">Loading…</p>
            ) : eligible.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">
                {eligibleFilter.trim()
                  ? 'No users match this filter (or everyone already has this role).'
                  : 'No users available to add.'}
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {eligible.map((u) => (
                  <li
                    key={u.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-white px-3 py-2.5 shadow-sm"
                  >
                    <div className="min-w-0 flex-1 text-sm">
                      <div className="truncate font-medium text-slate-900">
                        {u.displayName?.trim() || u.email}
                      </div>
                      {u.displayName?.trim() ? (
                        <div className="truncate text-xs text-slate-500">{u.email}</div>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleAdd(u.id)}
                      disabled={busyId === u.id}
                      className="shrink-0 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-800 transition hover:bg-indigo-100 disabled:opacity-50"
                    >
                      {busyId === u.id ? '…' : 'Add'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="border-t border-slate-200 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 sm:w-auto"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

type PermissionRowProps = {
  permission: Permission
  onSaveDescription: (id: string, description: string) => void
  onDelete: () => void
}

function PermissionRow({ permission, onSaveDescription, onDelete }: PermissionRowProps) {
  const [desc, setDesc] = useState(permission.description)

  useEffect(() => {
    setDesc(permission.description)
  }, [permission.description, permission.id])

  return (
    <tr className="border-b border-slate-100 last:border-0">
      <td className="px-4 py-3 font-mono text-xs text-slate-900">{permission.permissionString}</td>
      <td className="px-4 py-3">
        <input
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          className="w-full min-w-[12rem] rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-800"
        />
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onSaveDescription(permission.id, desc)}
            className="rounded-lg px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50"
          >
            Save
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-700"
            aria-label="Delete permission"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </td>
    </tr>
  )
}
