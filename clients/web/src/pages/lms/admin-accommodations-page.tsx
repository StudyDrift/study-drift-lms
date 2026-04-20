import { useCallback, useId, useState, type FormEvent } from 'react'
import { usePermissions } from '../../context/use-permissions'
import {
  createStudentAccommodation,
  deleteStudentAccommodation,
  fetchStudentAccommodationsForUser,
  searchAccommodationUsers,
  type AccommodationUserSearchHit,
  type CreateStudentAccommodationBody,
  type StudentAccommodationRecord,
} from '../../lib/courses-api'
import { PERM_ACCOMMODATIONS_MANAGE } from '../../lib/rbac-api'
import { LmsPage } from './lms-page'

function formatLearnerLabel(u: AccommodationUserSearchHit): string {
  const fn = u.firstName?.trim() ?? ''
  const ln = u.lastName?.trim() ?? ''
  const combined = [fn, ln].filter(Boolean).join(' ').trim()
  if (combined.length > 0) return combined
  const dn = u.displayName?.trim()
  if (dn) return dn
  return u.email
}

export default function AdminAccommodationsPage() {
  const formId = useId()
  const { allows, loading: permLoading } = usePermissions()
  const canManage = !permLoading && allows(PERM_ACCOMMODATIONS_MANAGE)

  const [searchInput, setSearchInput] = useState('')
  const [searchHits, setSearchHits] = useState<AccommodationUserSearchHit[]>([])
  const [searchBusy, setSearchBusy] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [selectedUser, setSelectedUser] = useState<AccommodationUserSearchHit | null>(null)

  const [rows, setRows] = useState<StudentAccommodationRecord[]>([])
  const [listError, setListError] = useState<string | null>(null)
  const [listBusy, setListBusy] = useState(false)

  const [courseCode, setCourseCode] = useState('')
  const [timeMultiplier, setTimeMultiplier] = useState('1.5')
  const [extraAttempts, setExtraAttempts] = useState('0')
  const [hintsAlways, setHintsAlways] = useState(false)
  const [reduced, setReduced] = useState(false)
  const [altFormat, setAltFormat] = useState('')
  const [effectiveFrom, setEffectiveFrom] = useState('')
  const [effectiveUntil, setEffectiveUntil] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveBusy, setSaveBusy] = useState(false)

  const runSearch = useCallback(async () => {
    const q = searchInput.trim()
    if (!q) {
      setSearchError('Enter an email, part of a name, campus id (sid), or user id.')
      setSearchHits([])
      return
    }
    setSearchBusy(true)
    setSearchError(null)
    try {
      const hits = await searchAccommodationUsers(q)
      setSearchHits(hits)
      if (hits.length === 0) {
        setSearchError('No matching users. Try a different spelling or a longer fragment.')
      }
    } catch (e) {
      setSearchHits([])
      setSearchError(e instanceof Error ? e.message : 'Search failed.')
    } finally {
      setSearchBusy(false)
    }
  }, [searchInput])

  const loadList = useCallback(async () => {
    if (!selectedUser) {
      setListError('Search and select a learner first.')
      return
    }
    setListBusy(true)
    setListError(null)
    try {
      const data = await fetchStudentAccommodationsForUser(selectedUser.id)
      setRows(data)
    } catch (e) {
      setRows([])
      setListError(e instanceof Error ? e.message : 'Could not load accommodations.')
    } finally {
      setListBusy(false)
    }
  }, [selectedUser])

  function pickUser(hit: AccommodationUserSearchHit) {
    setSelectedUser(hit)
    setSearchHits([])
    setSearchError(null)
    setRows([])
    setListError(null)
  }

  function clearSelection() {
    setSelectedUser(null)
    setRows([])
    setListError(null)
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault()
    if (!selectedUser) {
      setSaveError('Search and select a learner first.')
      return
    }
    const tm = Number(timeMultiplier)
    if (!Number.isFinite(tm) || tm < 1 || tm > 99.99) {
      setSaveError('Time multiplier must be between 1 and 99.99.')
      return
    }
    const ex = Number(extraAttempts)
    if (!Number.isInteger(ex) || ex < 0 || ex > 500) {
      setSaveError('Extra attempts must be an integer from 0 to 500.')
      return
    }
    setSaveBusy(true)
    setSaveError(null)
    try {
      const body: CreateStudentAccommodationBody = {
        courseCode: courseCode.trim() || null,
        timeMultiplier: tm,
        extraAttempts: ex,
        hintsAlwaysEnabled: hintsAlways,
        reducedDistractionMode: reduced,
        alternativeFormat: altFormat.trim() || null,
        effectiveFrom: effectiveFrom.trim() || null,
        effectiveUntil: effectiveUntil.trim() || null,
      }
      await createStudentAccommodation(selectedUser.id, body)
      setAltFormat('')
      await loadList()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed.')
    } finally {
      setSaveBusy(false)
    }
  }

  async function onDelete(id: string) {
    if (!selectedUser) return
    if (!window.confirm('Delete this accommodation record?')) return
    setSaveError(null)
    try {
      await deleteStudentAccommodation(selectedUser.id, id)
      await loadList()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Delete failed.')
    }
  }

  if (!canManage) {
    return (
      <LmsPage title="Accommodations">
        <p className="text-sm text-slate-600 dark:text-neutral-300">
          You need the accessibility coordinator or Global Admin role to manage student accommodations.
        </p>
      </LmsPage>
    )
  }

  return (
    <LmsPage title="Student accommodations">
      <div className="max-w-3xl space-y-6">
        <p className="text-sm text-slate-600 dark:text-neutral-300">
          Create operational accommodation settings per learner. Course-scoped records override global
          (all courses) settings. This page does not store disability documentation.
        </p>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-neutral-400">
            Find learner
          </label>
          <p className="mb-2 text-xs text-slate-500 dark:text-neutral-500">
            Search by email, first or last name, display name, campus student id (sid), or paste their user id
            (UUID).
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void runSearch()
                }
              }}
              className="min-w-[12rem] flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-950"
              placeholder="e.g. jordan@school.edu, Lee, or 00123456"
              spellCheck={false}
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => void runSearch()}
              disabled={searchBusy}
              className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-neutral-200 dark:text-neutral-900 dark:hover:bg-white"
            >
              {searchBusy ? 'Searching…' : 'Search'}
            </button>
          </div>
          {searchError && <p className="mt-2 text-sm text-rose-700 dark:text-rose-300">{searchError}</p>}

          {searchHits.length > 0 && (
            <ul className="mt-3 max-h-60 space-y-1 overflow-y-auto rounded-lg border border-slate-200 dark:border-neutral-700">
              {searchHits.map((hit) => (
                <li key={hit.id}>
                  <button
                    type="button"
                    onClick={() => pickUser(hit)}
                    className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-neutral-800"
                  >
                    <span className="font-medium text-slate-900 dark:text-neutral-100">
                      {formatLearnerLabel(hit)}
                    </span>
                    <span className="text-xs text-slate-600 dark:text-neutral-400">{hit.email}</span>
                    {hit.sid ? (
                      <span className="text-xs text-slate-500 dark:text-neutral-500">SID: {hit.sid}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {selectedUser && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-indigo-200 bg-indigo-50/80 px-3 py-2 text-sm dark:border-indigo-900 dark:bg-indigo-950/40">
              <div className="min-w-0">
                <p className="font-medium text-slate-900 dark:text-neutral-100">
                  Selected: {formatLearnerLabel(selectedUser)}
                </p>
                <p className="truncate text-xs text-slate-600 dark:text-neutral-400">{selectedUser.email}</p>
                <p className="mt-0.5 font-mono text-[11px] text-slate-500 dark:text-neutral-500">
                  User id: {selectedUser.id}
                </p>
              </div>
              <button
                type="button"
                onClick={clearSelection}
                className="shrink-0 rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-white dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-900"
              >
                Change learner
              </button>
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void loadList()}
              disabled={listBusy || !selectedUser}
              className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-neutral-200 dark:text-neutral-900 dark:hover:bg-white"
            >
              {listBusy ? 'Loading…' : 'Load accommodation records'}
            </button>
          </div>
          {listError && <p className="mt-2 text-sm text-rose-700 dark:text-rose-300">{listError}</p>}
        </div>

        <form
          id={formId}
          onSubmit={(e) => void onCreate(e)}
          className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-neutral-700 dark:bg-neutral-900"
        >
          <h2 className="text-sm font-semibold text-slate-900 dark:text-neutral-100">New record</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-neutral-400">
                Course code (optional)
              </label>
              <input
                value={courseCode}
                onChange={(e) => setCourseCode(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-950"
                placeholder="Leave blank for all courses"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-neutral-400">
                Time multiplier (1.0 = none)
              </label>
              <input
                value={timeMultiplier}
                onChange={(e) => setTimeMultiplier(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-950"
                inputMode="decimal"
              />
              <p className="mt-1 text-xs text-slate-500">Example: 1.5 for time-and-a-half.</p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-neutral-400">
                Extra quiz attempts
              </label>
              <input
                value={extraAttempts}
                onChange={(e) => setExtraAttempts(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-950"
                inputMode="numeric"
              />
            </div>
            <div className="flex flex-col gap-2 sm:col-span-2">
              <label className="inline-flex items-center gap-2 text-sm text-slate-800 dark:text-neutral-200">
                <input type="checkbox" checked={hintsAlways} onChange={(e) => setHintsAlways(e.target.checked)} />
                Always allow hints (overrides lockdown for this learner)
              </label>
              <label className="inline-flex items-center gap-2 text-sm text-slate-800 dark:text-neutral-200">
                <input type="checkbox" checked={reduced} onChange={(e) => setReduced(e.target.checked)} />
                Reduced-distraction quiz layout
              </label>
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-neutral-400">
                Alternative format notes (coordinator only)
              </label>
              <textarea
                value={altFormat}
                onChange={(e) => setAltFormat(e.target.value)}
                rows={2}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-950"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-neutral-400">
                Effective from (YYYY-MM-DD)
              </label>
              <input
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-950"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-neutral-400">
                Effective until (YYYY-MM-DD)
              </label>
              <input
                value={effectiveUntil}
                onChange={(e) => setEffectiveUntil(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-950"
              />
            </div>
          </div>
          {saveError && <p className="text-sm text-rose-700 dark:text-rose-300">{saveError}</p>}
          <button
            type="submit"
            disabled={saveBusy || !selectedUser}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {saveBusy ? 'Saving…' : 'Create record'}
          </button>
        </form>

        {rows.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-neutral-700 dark:bg-neutral-900">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-600 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-400">
                <tr>
                  <th className="px-3 py-2">Scope</th>
                  <th className="px-3 py-2">Multiplier</th>
                  <th className="px-3 py-2">Extra</th>
                  <th className="px-3 py-2">Flags</th>
                  <th className="px-3 py-2">Dates</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 dark:border-neutral-800">
                    <td className="px-3 py-2 text-slate-800 dark:text-neutral-200">
                      {r.courseCode ?? 'All courses'}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{r.timeMultiplier}</td>
                    <td className="px-3 py-2 tabular-nums">{r.extraAttempts}</td>
                    <td className="px-3 py-2 text-xs text-slate-600 dark:text-neutral-400">
                      {[r.hintsAlwaysEnabled && 'hints', r.reducedDistractionMode && 'reduced']
                        .filter(Boolean)
                        .join(', ') || '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600 dark:text-neutral-400">
                      {[r.effectiveFrom, r.effectiveUntil].filter(Boolean).join(' → ') || '—'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        className="text-rose-700 hover:underline dark:text-rose-300"
                        onClick={() => void onDelete(r.id)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </LmsPage>
  )
}
