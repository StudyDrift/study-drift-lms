import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Building2, Plus, RefreshCw } from 'lucide-react'
import { authorizedFetch } from '../../lib/api'
import { readApiErrorMessage } from '../../lib/errors'
import { toastMutationError, toastSaveOk } from '../../lib/lms-toast'

type OrgRow = {
  id: string
  slug: string
  name: string
  status: string
  maxUsers?: number | null
  maxCourses?: number | null
  dataRegion: string
  userCount: number
  courseCount: number
  createdAt: string
}

export function OrganizationsPanel() {
  const [orgs, setOrgs] = useState<OrgRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [newSlug, setNewSlug] = useState('')
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await authorizedFetch('/api/v1/admin/orgs?limit=200')
      const raw: unknown = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(readApiErrorMessage(raw))
      const data = raw as { organizations?: OrgRow[] }
      setOrgs(data.organizations ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load organizations.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function createOrg(e: FormEvent) {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return
    setCreating(true)
    try {
      const body: Record<string, unknown> = { name }
      const s = newSlug.trim()
      if (s) body.slug = s
      const res = await authorizedFetch('/api/v1/admin/orgs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const raw: unknown = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(readApiErrorMessage(raw))
      toastSaveOk('Organization created.')
      setNewName('')
      setNewSlug('')
      await load()
    } catch (err) {
      toastMutationError(err instanceof Error ? err.message : 'Request failed.')
    } finally {
      setCreating(false)
    }
  }

  async function setStatus(id: string, name: string, next: 'active' | 'suspended') {
    if (next === 'suspended' && !window.confirm(`Suspend organization “${name}”? Users in this org will be blocked from signing in.`)) {
      return
    }
    try {
      const res = await authorizedFetch(`/api/v1/admin/orgs/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      })
      const raw: unknown = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(readApiErrorMessage(raw))
      toastSaveOk(next === 'suspended' ? 'Organization suspended.' : 'Organization reactivated.')
      await load()
    } catch (err) {
      toastMutationError(err instanceof Error ? err.message : 'Request failed.')
    }
  }

  return (
    <div className="mt-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600 dark:text-neutral-400">
          Provision tenants and monitor usage. Slugs are unique and lowercased.
        </p>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden />
          Refresh
        </button>
      </div>

      <form
        onSubmit={createOrg}
        className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 dark:border-neutral-600 dark:bg-neutral-800/40"
        aria-labelledby="new-org-heading"
      >
        <h3 id="new-org-heading" className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-neutral-100">
          <Plus className="h-4 w-4" aria-hidden />
          New organization
        </h3>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-medium text-slate-700 dark:text-neutral-300">
            Name
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-900"
              placeholder="Riverdale USD"
              autoComplete="organization"
            />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-medium text-slate-700 dark:text-neutral-300">
            Slug (optional)
            <input
              value={newSlug}
              onChange={(e) => setNewSlug(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-900"
              placeholder="riverdale-usd"
              autoComplete="off"
            />
          </label>
          <button
            type="submit"
            disabled={creating || !newName.trim()}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Building2 className="h-4 w-4" aria-hidden />
            Create
          </button>
        </div>
      </form>

      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-100" role="alert">
          {error}
        </p>
      )}

      {loading && orgs.length === 0 ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading organizations">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-xl bg-slate-100 dark:bg-neutral-800" />
          ))}
        </div>
      ) : orgs.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-600 dark:border-neutral-600 dark:text-neutral-400">
          No organizations yet — create your first one.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-neutral-600">
          <table className="min-w-full divide-y divide-slate-200 text-left text-sm dark:divide-neutral-600">
            <thead className="bg-slate-50 dark:bg-neutral-800/80">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium text-slate-700 dark:text-neutral-200">
                  Name
                </th>
                <th scope="col" className="px-3 py-2 font-medium text-slate-700 dark:text-neutral-200">
                  Slug
                </th>
                <th scope="col" className="px-3 py-2 font-medium text-slate-700 dark:text-neutral-200">
                  Status
                </th>
                <th scope="col" className="px-3 py-2 font-medium text-slate-700 dark:text-neutral-200">
                  Users
                </th>
                <th scope="col" className="px-3 py-2 font-medium text-slate-700 dark:text-neutral-200">
                  Courses
                </th>
                <th scope="col" className="px-3 py-2 font-medium text-slate-700 dark:text-neutral-200">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white dark:divide-neutral-600 dark:bg-neutral-900">
              {orgs.map((o) => (
                <tr key={o.id} className="hover:bg-slate-50 dark:hover:bg-neutral-800/60">
                  <th scope="row" className="whitespace-nowrap px-3 py-2.5 font-medium text-slate-900 dark:text-neutral-100">
                    {o.name}
                  </th>
                  <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-slate-600 dark:text-neutral-300">{o.slug}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-slate-600 dark:text-neutral-300">{o.status}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-slate-600 dark:text-neutral-300">{o.userCount}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-slate-600 dark:text-neutral-300">{o.courseCount}</td>
                  <td className="px-3 py-2.5">
                    {o.slug === 'default' ? (
                      <span className="text-xs text-slate-400 dark:text-neutral-500">—</span>
                    ) : o.status === 'active' ? (
                      <button
                        type="button"
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 hover:border-amber-200 hover:bg-amber-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
                        onClick={() => void setStatus(o.id, o.name, 'suspended')}
                      >
                        Suspend
                      </button>
                    ) : o.status === 'suspended' ? (
                      <button
                        type="button"
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 hover:border-emerald-200 hover:bg-emerald-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
                        onClick={() => void setStatus(o.id, o.name, 'active')}
                      >
                        Reactivate
                      </button>
                    ) : (
                      <span className="text-xs text-slate-400 dark:text-neutral-500">Deleted</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
