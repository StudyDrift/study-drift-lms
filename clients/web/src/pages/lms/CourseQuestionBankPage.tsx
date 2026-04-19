import { useCallback, useEffect, useId, useState } from 'react'
import { useParams } from 'react-router-dom'
import { usePermissions } from '../../context/usePermissions'
import {
  courseItemsCreatePermission,
  fetchCourse,
  fetchCourseQuestions,
  type BankQuestionRow,
} from '../../lib/coursesApi'
import { LmsPage } from './LmsPage'

export function CourseQuestionBankPage() {
  const { courseCode = '' } = useParams<{ courseCode: string }>()
  const searchId = useId()
  const { allows, loading: permLoading } = usePermissions()
  const canEdit = !permLoading && allows(courseItemsCreatePermission(courseCode))

  const [rows, setRows] = useState<BankQuestionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [bankOn, setBankOn] = useState(false)

  const load = useCallback(async () => {
    if (!courseCode) return
    setLoading(true)
    setError(null)
    try {
      const course = await fetchCourse(courseCode)
      setBankOn(course.questionBankEnabled === true)
      if (course.questionBankEnabled !== true) {
        setRows([])
        return
      }
      const data = await fetchCourseQuestions(courseCode, { q: q.trim() || undefined })
      setRows(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load questions.')
    } finally {
      setLoading(false)
    }
  }, [courseCode, q])

  useEffect(() => {
    void load()
  }, [load])

  if (!canEdit) {
    return (
      <LmsPage title="Question bank">
        <p className="text-sm text-slate-600 dark:text-neutral-300">
          You do not have access to manage this course&apos;s question bank.
        </p>
      </LmsPage>
    )
  }

  return (
    <LmsPage title="Question bank">
      <div className="max-w-5xl space-y-4">
        <p className="text-sm text-slate-600 dark:text-neutral-300">
          Browse normalized questions for this course. Enable the tool under{' '}
          <strong>Course settings → Course tools</strong> if it is off.
        </p>
        {!bankOn && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100">
            The question bank feature is disabled for this course. Turn on &quot;Question bank&quot; in course
            features to sync quiz edits and use pools.
          </p>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[12rem] flex-1">
            <label htmlFor={searchId} className="text-xs font-medium text-slate-700 dark:text-neutral-200">
              Search stem
            </label>
            <input
              id={searchId}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
              placeholder="Keywords…"
            />
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500"
          >
            Search
          </button>
        </div>
        {error && (
          <p className="text-sm text-rose-700 dark:text-rose-400" role="alert">
            {error}
          </p>
        )}
        {loading ? (
          <p className="text-sm text-slate-500 dark:text-neutral-400">Loading…</p>
        ) : (
          <div
            className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-950"
            role="grid"
            aria-label="Question bank"
          >
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300">
                <tr>
                  <th scope="col" className="px-4 py-3">
                    Stem
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Type
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Points
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-neutral-800">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-slate-500 dark:text-neutral-400">
                      No questions found. Save a module quiz while the bank is enabled to sync items from the
                      editor.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50/80 dark:hover:bg-neutral-900/60">
                      <td className="max-w-md truncate px-4 py-3 text-slate-900 dark:text-neutral-100">
                        {r.stem}
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-neutral-300">{r.questionType}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-neutral-300">{r.status}</td>
                      <td className="px-4 py-3 tabular-nums text-slate-600 dark:text-neutral-300">{r.points}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </LmsPage>
  )
}
