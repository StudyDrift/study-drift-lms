import { type FormEvent, useCallback, useEffect, useId, useMemo, useState } from 'react'
import { CalendarRange, Plus, Trash2 } from 'lucide-react'
import { authorizedFetch } from '../../lib/api'
import { decodeJwtPayload } from '../../lib/jwt-payload'
import { getAccessToken } from '../../lib/auth'
import { readApiErrorMessage } from '../../lib/errors'
import { usePermissions } from '../../context/use-permissions'
import { PERM_RBAC_MANAGE, PERM_TENANT_ORG_UNITS_ADMIN } from '../../lib/rbac-api'

export type TermRow = {
  id: string
  orgId: string
  name: string
  termType: string
  startDate: string
  endDate: string
  status: string
  createdAt: string
  updatedAt: string
}

export function TermsSettingsPanel() {
  const headingId = useId()
  const errId = useId()
  const { allows, loading: permLoading } = usePermissions()
  const jwtOrgId = decodeJwtPayload(getAccessToken())?.org_id ?? null
  const canManageTerms =
    !permLoading && (allows(PERM_RBAC_MANAGE) || allows(PERM_TENANT_ORG_UNITS_ADMIN))

  const [orgId, setOrgId] = useState<string>(jwtOrgId ?? '')
  const [orgs, setOrgs] = useState<{ id: string; name: string }[]>([])
  const [terms, setTerms] = useState<TermRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState('semester')
  const [newStart, setNewStart] = useState('')
  const [newEnd, setNewEnd] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (!canManageTerms) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await authorizedFetch('/api/v1/admin/orgs?limit=200')
        const raw: unknown = await res.json().catch(() => ({}))
        if (!res.ok || cancelled) return
        const list = (raw as { organizations?: { id: string; name: string }[] }).organizations ?? []
        setOrgs(list.map((o) => ({ id: o.id, name: o.name })))
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [canManageTerms])

  useEffect(() => {
    if (jwtOrgId && !orgId) setOrgId(jwtOrgId)
  }, [jwtOrgId, orgId])

  const loadTerms = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    setError(null)
    try {
      const res = await authorizedFetch(`/api/v1/orgs/${encodeURIComponent(orgId)}/terms`)
      const raw: unknown = await res.json().catch(() => ({}))
      if (!res.ok) {
        setTerms([])
        setError(readApiErrorMessage(raw))
        return
      }
      const data = raw as { terms?: TermRow[] }
      setTerms(data.terms ?? [])
    } catch {
      setTerms([])
      setError('Could not load terms.')
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    if (orgId) void loadTerms()
  }, [orgId, loadTerms])

  async function createTerm(e: FormEvent) {
    e.preventDefault()
    if (!orgId || !newName.trim() || !newStart || !newEnd) return
    setCreating(true)
    setError(null)
    try {
      const res = await authorizedFetch(`/api/v1/orgs/${encodeURIComponent(orgId)}/terms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          termType: newType,
          startDate: newStart,
          endDate: newEnd,
        }),
      })
      const raw: unknown = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(readApiErrorMessage(raw))
        return
      }
      setNewName('')
      await loadTerms()
    } catch {
      setError('Could not create term.')
    } finally {
      setCreating(false)
    }
  }

  async function deleteTerm(id: string) {
    if (!orgId) return
    if (!window.confirm('Delete this term? Courses must be unlinked first.')) return
    setError(null)
    try {
      const res = await authorizedFetch(
        `/api/v1/orgs/${encodeURIComponent(orgId)}/terms/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      )
      if (!res.ok && res.status !== 204) {
        const raw: unknown = await res.json().catch(() => ({}))
        setError(readApiErrorMessage(raw))
        return
      }
      await loadTerms()
    } catch {
      setError('Could not delete term.')
    }
  }

  const orgSelect = useMemo(() => {
    if (orgs.length === 0 && jwtOrgId) {
      return null
    }
    return (
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-slate-700 dark:text-neutral-200">Organization</span>
        <select
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
          value={orgId}
          onChange={(e) => setOrgId(e.target.value)}
          aria-label="Organization for terms"
        >
          <option value="">Select organization</option>
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </label>
    )
  }, [orgs, orgId, jwtOrgId])

  if (!canManageTerms) {
    return (
      <p className="text-sm text-slate-600 dark:text-neutral-400">
        You need org administrator permissions to manage academic terms.
      </p>
    )
  }

  return (
    <section className="space-y-6" aria-labelledby={headingId}>
      <div className="flex items-start gap-3">
        <CalendarRange className="mt-1 h-5 w-5 text-indigo-600" aria-hidden />
        <div>
          <h2 id={headingId} className="text-lg font-semibold text-slate-900 dark:text-neutral-100">
            Academic terms
          </h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-neutral-400">
            Create semesters or grading periods so courses can inherit schedule dates and learners can filter their
            catalog.
          </p>
        </div>
      </div>

      {orgs.length > 0 ? orgSelect : null}

      <form
        className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-neutral-700 dark:bg-neutral-900/40"
        onSubmit={(e) => void createTerm(e)}
      >
        <p className="text-sm font-medium text-slate-800 dark:text-neutral-100">Create term</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span>Name</span>
            <input
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Fall 2026"
              required
              aria-required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>Type</span>
            <select
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
              value={newType}
              onChange={(e) => setNewType(e.target.value)}
              aria-label="Term type"
            >
              <option value="semester">Semester</option>
              <option value="quarter">Quarter</option>
              <option value="trimester">Trimester</option>
              <option value="year">Year</option>
              <option value="grading_period">Grading period</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>Start</span>
            <input
              type="date"
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
              value={newStart}
              onChange={(e) => setNewStart(e.target.value)}
              required
              aria-required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>End</span>
            <input
              type="date"
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
              value={newEnd}
              onChange={(e) => setNewEnd(e.target.value)}
              required
              aria-required
            />
          </label>
        </div>
        <button
          type="submit"
          disabled={creating || !orgId}
          className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Add term
        </button>
      </form>

      {error && (
        <p
          id={errId}
          className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-200"
          role="alert"
        >
          {error}
        </p>
      )}

      <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-neutral-700">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-700 dark:bg-neutral-900 dark:text-neutral-200">
            <tr>
              <th className="px-4 py-3 font-semibold">Name</th>
              <th className="px-4 py-3 font-semibold">Dates</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-slate-500">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && terms.length === 0 && orgId && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-slate-600 dark:text-neutral-400">
                  No terms configured. Create your first term to organize courses by semester.
                </td>
              </tr>
            )}
            {!loading &&
              terms.map((t) => (
                <tr key={t.id} className="border-t border-slate-100 dark:border-neutral-800">
                  <td className="px-4 py-3 font-medium text-slate-900 dark:text-neutral-100">{t.name}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-neutral-400">
                    {t.startDate} — {t.endDate}
                  </td>
                  <td className="px-4 py-3 capitalize text-slate-700 dark:text-neutral-300">{t.status}</td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-800"
                      onClick={() => void deleteTerm(t.id)}
                      aria-label={`Delete term ${t.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
