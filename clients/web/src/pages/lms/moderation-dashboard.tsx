import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  fetchModerationReconciliation,
  postModerationReconcile,
  type ModerationReconciliationRow,
} from '../../lib/courses-api'
import { LmsPage } from './lms-page'

export default function ModerationDashboard() {
  const { courseCode, itemId } = useParams<{ courseCode: string; itemId: string }>()
  const [rows, setRows] = useState<ModerationReconciliationRow[]>([])
  const [unreconciledFlagged, setUnreconciledFlagged] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!courseCode || !itemId) return
    setLoading(true)
    setError(null)
    try {
      const data = await fetchModerationReconciliation(courseCode, itemId)
      setRows(data.rows)
      setUnreconciledFlagged(data.unreconciledFlaggedCount)
    } catch (e) {
      setRows([])
      setUnreconciledFlagged(0)
      setError(e instanceof Error ? e.message : 'Could not load reconciliation data.')
    } finally {
      setLoading(false)
    }
  }, [courseCode, itemId])

  useEffect(() => {
    void load()
  }, [load])

  async function reconcile(
    submissionId: string,
    body: {
      action: 'accept_grader' | 'average' | 'override' | 'single'
      graderId?: string
      overrideScore?: number
    },
  ) {
    if (!courseCode || !itemId) return
    setBusyId(submissionId)
    setError(null)
    try {
      await postModerationReconcile(courseCode, itemId, submissionId, body)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reconciliation failed.')
    } finally {
      setBusyId(null)
    }
  }

  if (!courseCode || !itemId) {
    return (
      <LmsPage title="Moderation" description="">
        <p className="mt-6 text-sm text-slate-500">Invalid link.</p>
      </LmsPage>
    )
  }

  const back = `/courses/${encodeURIComponent(courseCode)}/modules/assignment/${encodeURIComponent(itemId)}`

  return (
    <LmsPage
      title="Moderated grading"
      description="Compare provisional scores and record the final gradebook score for each submission."
      actions={
        <Link
          to={back}
          className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50 dark:border-neutral-600 dark:bg-neutral-950 dark:text-neutral-100 dark:hover:bg-neutral-900"
        >
          Back to assignment
        </Link>
      }
    >
      {error ? (
        <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-200">
          {error}
        </p>
      ) : null}
      {!loading && unreconciledFlagged > 0 ? (
        <p className="mt-4 text-sm font-medium text-amber-800 dark:text-amber-200">
          {unreconciledFlagged} flagged submission{unreconciledFlagged === 1 ? '' : 's'} still need
          reconciliation before the gradebook can be saved for this assignment.
        </p>
      ) : null}
      {loading ? (
        <p className="mt-8 text-sm text-slate-500 dark:text-neutral-400">Loading…</p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200 dark:border-neutral-700">
          <table
            className="min-w-full border-collapse text-left text-sm"
            role="grid"
            aria-label="Moderated grading reconciliation"
          >
            <thead className="bg-slate-50 text-slate-600 dark:bg-neutral-900 dark:text-neutral-300">
              <tr>
                <th className="border-b border-slate-200 px-3 py-2 font-medium dark:border-neutral-700">
                  Submission
                </th>
                <th className="border-b border-slate-200 px-3 py-2 font-medium dark:border-neutral-700">
                  Student
                </th>
                <th className="border-b border-slate-200 px-3 py-2 font-medium dark:border-neutral-700">
                  Provisional scores
                </th>
                <th className="border-b border-slate-200 px-3 py-2 font-medium dark:border-neutral-700">
                  Status
                </th>
                <th className="border-b border-slate-200 px-3 py-2 font-medium dark:border-neutral-700">
                  Final
                </th>
                <th className="border-b border-slate-200 px-3 py-2 font-medium dark:border-neutral-700">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.submissionId}
                  className="border-b border-slate-100 last:border-0 dark:border-neutral-800"
                >
                  <td className="px-3 py-2 font-mono text-xs text-slate-600 dark:text-neutral-400">
                    {r.submissionId.slice(0, 8)}…
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-600 dark:text-neutral-400">
                    {r.studentUserId.slice(0, 8)}…
                  </td>
                  <td className="px-3 py-2 text-slate-800 dark:text-neutral-100">
                    {r.provisional.length === 0 ? (
                      <span className="text-slate-400">—</span>
                    ) : (
                      <ul className="list-inside list-disc">
                        {r.provisional.map((p) => (
                          <li key={`${p.graderId}-${p.score}`}>
                            {p.score}
                            <span className="ml-1 text-xs text-slate-400">({p.graderId.slice(0, 8)}…)</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {r.flagged ? (
                      <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950/80 dark:text-amber-100">
                        Needs review
                      </span>
                    ) : (
                      <span className="text-xs text-slate-500 dark:text-neutral-500">Within threshold</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-800 dark:text-neutral-100">
                    {r.finalScore != null ? String(r.finalScore) : '—'}
                    {r.reconciliationSource ? (
                      <span className="ml-1 text-xs text-slate-400">({r.reconciliationSource})</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {r.provisional.map((p) => (
                        <button
                          key={p.graderId}
                          type="button"
                          disabled={busyId === r.submissionId}
                          onClick={() =>
                            void reconcile(r.submissionId, {
                              action: 'accept_grader',
                              graderId: p.graderId,
                            })
                          }
                          className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-950 dark:text-neutral-100 dark:hover:bg-neutral-900"
                        >
                          Use {p.score}
                        </button>
                      ))}
                      {r.provisional.length >= 2 ? (
                        <button
                          type="button"
                          disabled={busyId === r.submissionId}
                          onClick={() => void reconcile(r.submissionId, { action: 'average' })}
                          className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-950 dark:text-neutral-100 dark:hover:bg-neutral-900"
                        >
                          Average
                        </button>
                      ) : null}
                      {r.provisional.length === 1 ? (
                        <button
                          type="button"
                          disabled={busyId === r.submissionId}
                          onClick={() => void reconcile(r.submissionId, { action: 'single' })}
                          className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-950 dark:text-neutral-100 dark:hover:bg-neutral-900"
                        >
                          Confirm single
                        </button>
                      ) : null}
                      <button
                        type="button"
                        disabled={busyId === r.submissionId}
                        onClick={() => {
                          const raw = window.prompt(
                            `Override final score (0–${r.pointsWorth ?? 'max'} points)`,
                            r.finalScore != null ? String(r.finalScore) : '',
                          )
                          if (raw == null || raw.trim() === '') return
                          const n = Number(raw)
                          if (!Number.isFinite(n)) return
                          void reconcile(r.submissionId, { action: 'override', overrideScore: n })
                        }}
                        className="rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-900 hover:bg-indigo-100 disabled:opacity-50 dark:border-indigo-900 dark:bg-indigo-950/60 dark:text-indigo-100 dark:hover:bg-indigo-950"
                      >
                        Override…
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </LmsPage>
  )
}
