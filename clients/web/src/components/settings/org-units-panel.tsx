import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ChevronRight, FolderTree, Plus, RefreshCw } from 'lucide-react'
import { authorizedFetch } from '../../lib/api'
import { getAccessToken } from '../../lib/auth'
import { decodeJwtPayload } from '../../lib/jwt-payload'
import { PERM_RBAC_MANAGE, PERM_TENANT_ORG_UNITS_ADMIN } from '../../lib/rbac-api'
import { readApiErrorMessage } from '../../lib/errors'
import { toastMutationError, toastSaveOk } from '../../lib/lms-toast'
import { usePermissions } from '../../context/use-permissions'

type OrgRow = {
  id: string
  name: string
  slug: string
}

type TreeNode = {
  id: string
  name: string
  unitType: string
  status: string
  childCourseCount: number
  children: TreeNode[]
}

const UNIT_TYPES = ['district', 'school', 'college', 'department', 'other'] as const

function TreeBranch({
  node,
  depth,
  onAddChild,
  canAddChild,
}: {
  node: TreeNode
  depth: number
  onAddChild: (parentId: string) => void
  canAddChild: boolean
}) {
  const [open, setOpen] = useState(depth < 2)
  const hasKids = node.children.length > 0
  return (
    <li role="treeitem" aria-selected={false} aria-expanded={hasKids ? open : undefined} className="select-none">
      <div className="flex flex-wrap items-center gap-2 py-1.5" style={{ paddingLeft: depth * 12 }}>
        {hasKids ? (
          <button
            type="button"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? 'Collapse' : 'Expand'}
          >
            <ChevronRight className={`h-4 w-4 transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden />
          </button>
        ) : (
          <span className="inline-block w-7 shrink-0" aria-hidden />
        )}
        <span className="font-medium text-slate-900 dark:text-neutral-100">{node.name}</span>
        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-neutral-800 dark:text-neutral-300">
          {node.unitType}
        </span>
        {node.childCourseCount > 0 && (
          <span className="text-xs text-slate-500 dark:text-neutral-400">{node.childCourseCount} courses</span>
        )}
        {canAddChild && (
          <button
            type="button"
            className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
            onClick={() => onAddChild(node.id)}
          >
            Add sub-unit
          </button>
        )}
      </div>
      {hasKids && open && (
        <ul role="group" className="list-none border-l border-slate-200 pl-1 dark:border-neutral-700">
          {node.children.map((c) => (
            <TreeBranch
              key={c.id}
              node={c}
              depth={depth + 1}
              onAddChild={onAddChild}
              canAddChild={canAddChild}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

export function OrgUnitsPanel() {
  const { allows, loading: permLoading } = usePermissions()
  const canRbac = !permLoading && allows(PERM_RBAC_MANAGE)
  const canUnits = !permLoading && (canRbac || allows(PERM_TENANT_ORG_UNITS_ADMIN))

  const jwtOrgId = decodeJwtPayload(getAccessToken())?.org_id ?? null

  const [orgs, setOrgs] = useState<OrgRow[]>([])
  const [orgId, setOrgId] = useState<string>('')
  const [tree, setTree] = useState<TreeNode[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [rootName, setRootName] = useState('')
  const [rootType, setRootType] = useState<string>('school')
  const [creatingRoot, setCreatingRoot] = useState(false)

  const [childParentId, setChildParentId] = useState<string | null>(null)
  const [childName, setChildName] = useState('')
  const [childType, setChildType] = useState<string>('department')
  const [creatingChild, setCreatingChild] = useState(false)

  const loadOrgs = useCallback(async () => {
    if (!canRbac) return
    try {
      const res = await authorizedFetch('/api/v1/admin/orgs?limit=200')
      const raw: unknown = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(readApiErrorMessage(raw))
      const data = raw as { organizations?: OrgRow[] }
      setOrgs(data.organizations ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load organizations.')
    }
  }, [canRbac])

  const loadTree = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    setError(null)
    try {
      const res = await authorizedFetch(`/api/v1/admin/orgs/${encodeURIComponent(orgId)}/units/tree`)
      const raw: unknown = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(readApiErrorMessage(raw))
      const data = raw as { tree?: TreeNode[] }
      setTree(data.tree ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load unit tree.')
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    void loadOrgs()
  }, [loadOrgs])

  useEffect(() => {
    if (canRbac && orgs.length > 0 && !orgId) {
      setOrgId(orgs[0].id)
    }
    if (!canRbac && jwtOrgId && !orgId) {
      setOrgId(jwtOrgId)
    }
  }, [canRbac, orgs, orgId, jwtOrgId])

  useEffect(() => {
    if (orgId && canUnits) void loadTree()
  }, [orgId, canUnits, loadTree])

  async function createRoot(e: FormEvent) {
    e.preventDefault()
    const name = rootName.trim()
    if (!name || !orgId) return
    setCreatingRoot(true)
    try {
      const res = await authorizedFetch(`/api/v1/admin/orgs/${encodeURIComponent(orgId)}/units`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, unitType: rootType }),
      })
      const raw: unknown = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(readApiErrorMessage(raw))
      toastSaveOk('Unit created.')
      setRootName('')
      await loadTree()
    } catch (err) {
      toastMutationError(err instanceof Error ? err.message : 'Request failed.')
    } finally {
      setCreatingRoot(false)
    }
  }

  async function createChild(e: FormEvent) {
    e.preventDefault()
    const name = childName.trim()
    if (!name || !orgId || !childParentId) return
    setCreatingChild(true)
    try {
      const res = await authorizedFetch(
        `/api/v1/admin/orgs/${encodeURIComponent(orgId)}/units/${encodeURIComponent(childParentId)}/children`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, unitType: childType }),
        },
      )
      const raw: unknown = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(readApiErrorMessage(raw))
      toastSaveOk('Sub-unit created.')
      setChildName('')
      setChildParentId(null)
      await loadTree()
    } catch (err) {
      toastMutationError(err instanceof Error ? err.message : 'Request failed.')
    } finally {
      setCreatingChild(false)
    }
  }

  if (!canUnits) {
    return (
      <p className="mt-2 text-sm text-slate-600 dark:text-neutral-400">
        You need the Org Unit Admin role or platform administration access to manage schools and departments.
      </p>
    )
  }

  return (
    <div className="mt-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600 dark:text-neutral-400">
          Structure your tenant with nested schools and departments. Course catalog visibility can be limited to a unit
          subtree for Org Unit Admins.
        </p>
        <button
          type="button"
          onClick={() => void loadTree()}
          disabled={loading || !orgId}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden />
          Refresh
        </button>
      </div>

      {canRbac && orgs.length > 0 && (
        <label className="flex max-w-md flex-col gap-1 text-xs font-medium text-slate-700 dark:text-neutral-300">
          Organization
          <select
            value={orgId}
            onChange={(e) => setOrgId(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-900"
          >
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} ({o.slug})
              </option>
            ))}
          </select>
        </label>
      )}

      {!canRbac && jwtOrgId && (
        <p className="text-sm text-slate-600 dark:text-neutral-400">
          Managing units for your organization (org id <span className="font-mono text-xs">{jwtOrgId}</span>).
        </p>
      )}

      {error && (
        <p
          className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-100"
          role="alert"
        >
          {error}
        </p>
      )}

      {canRbac && (
        <form
          onSubmit={createRoot}
          className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 dark:border-neutral-600 dark:bg-neutral-800/40"
          aria-labelledby="root-unit-heading"
        >
          <h3
            id="root-unit-heading"
            className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-neutral-100"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Add root unit
          </h3>
          <p className="mt-1 text-xs text-slate-500 dark:text-neutral-400">Platform admins can create top-level units.</p>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-medium text-slate-700 dark:text-neutral-300">
              Name
              <input
                value={rootName}
                onChange={(e) => setRootName(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-900"
                placeholder="Lincoln High"
              />
            </label>
            <label className="flex w-40 flex-col gap-1 text-xs font-medium text-slate-700 dark:text-neutral-300">
              Type
              <select
                value={rootType}
                onChange={(e) => setRootType(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-900"
              >
                {UNIT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={creatingRoot || !rootName.trim() || !orgId}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Create
            </button>
          </div>
        </form>
      )}

      {childParentId && (
        <form
          onSubmit={createChild}
          className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-4 dark:border-indigo-900/40 dark:bg-indigo-950/20"
          role="dialog"
          aria-label="Add sub-unit"
        >
          <p className="text-sm font-medium text-slate-900 dark:text-neutral-100">New sub-unit under selected parent</p>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-medium text-slate-700 dark:text-neutral-300">
              Name
              <input
                value={childName}
                onChange={(e) => setChildName(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-900"
                placeholder="Math department"
              />
            </label>
            <label className="flex w-40 flex-col gap-1 text-xs font-medium text-slate-700 dark:text-neutral-300">
              Type
              <select
                value={childType}
                onChange={(e) => setChildType(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-900"
              >
                {UNIT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={creatingChild || !childName.trim()}
              className="inline-flex shrink-0 items-center justify-center rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              className="text-sm text-slate-600 underline dark:text-neutral-400"
              onClick={() => {
                setChildParentId(null)
                setChildName('')
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading && tree.length === 0 ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading unit tree">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded-xl bg-slate-100 dark:bg-neutral-800" />
          ))}
        </div>
      ) : tree.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-600 dark:border-neutral-600 dark:text-neutral-400">
          <FolderTree className="mx-auto mb-2 h-8 w-8 opacity-50" aria-hidden />
          No sub-accounts yet. Add a school or department to structure your organization.
        </p>
      ) : (
        <ul
          role="tree"
          aria-label="Organization units"
          aria-multiselectable="false"
          className="list-none rounded-xl border border-slate-200 p-3 dark:border-neutral-600"
        >
          {tree.map((n) => (
            <TreeBranch
              key={n.id}
              node={n}
              depth={0}
              onAddChild={(id) => {
                setChildParentId(id)
                setChildName('')
              }}
              canAddChild
            />
          ))}
        </ul>
      )}
    </div>
  )
}
