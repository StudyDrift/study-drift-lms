import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { ConfirmDialog } from '../../components/confirm-dialog'
import { usePermissions } from '../../context/use-permissions'
import {
  courseItemsCreatePermission,
  fetchMisconceptionReport,
  postImportMisconceptionSeedLibrary,
  type CoursePublic,
  type MisconceptionReportRow,
} from '../../lib/courses-api'
import { toastMutationError, toastSaveOk } from '../../lib/lms-toast'

type CourseLayoutContext = {
  course: CoursePublic
}

export default function CourseMisconceptionReportPage() {
  const { course } = useOutletContext<CourseLayoutContext>()
  const { allows, loading: permLoading } = usePermissions()
  const canManage = !permLoading && allows(courseItemsCreatePermission(course.courseCode))
  const [rows, setRows] = useState<MisconceptionReportRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [importBusy, setImportBusy] = useState(false)
  const [replaceSeedsOpen, setReplaceSeedsOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setError(null)
      try {
        const res = await fetchMisconceptionReport(course.courseCode)
        if (!cancelled) setRows(res.misconceptions)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load report.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [course.courseCode])

  async function runImport(replaceExistingSeeds: boolean) {
    setImportBusy(true)
    setError(null)
    try {
      const res = await postImportMisconceptionSeedLibrary(course.courseCode, { replaceExistingSeeds })
      toastSaveOk(`Imported ${res.imported} seed misconception${res.imported === 1 ? '' : 's'} (${res.skipped} skipped).`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Import failed.'
      setError(msg)
      toastMutationError(msg)
    } finally {
      setImportBusy(false)
      setReplaceSeedsOpen(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <ConfirmDialog
        open={replaceSeedsOpen}
        title="Replace seed misconceptions?"
        description="This removes existing items marked as seed in this course, then re-imports the built-in K–12 library."
        confirmLabel="Replace and import"
        variant="danger"
        busy={importBusy}
        onClose={() => !importBusy && setReplaceSeedsOpen(false)}
        onConfirm={() => void runImport(true)}
      />
      <div>
        <h1 className="text-lg font-semibold text-slate-900 dark:text-neutral-100">Misconception report</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-neutral-400">
          Trigger counts for tagged distractors across submitted quiz attempts in this course.
        </p>
        {canManage ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={importBusy}
              onClick={() => void runImport(false)}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
            >
              {importBusy ? 'Working…' : 'Import seed library'}
            </button>
            <button
              type="button"
              disabled={importBusy}
              onClick={() => setReplaceSeedsOpen(true)}
              className="rounded-md border border-rose-300 bg-rose-50 px-3 py-1.5 text-sm font-medium text-rose-900 hover:bg-rose-100 disabled:opacity-50 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-100 dark:hover:bg-rose-950/70"
            >
              Replace seeds & re-import
            </button>
          </div>
        ) : null}
      </div>
      {error && (
        <p className="text-sm text-rose-700 dark:text-rose-400" role="alert">
          {error}
        </p>
      )}
      {rows && rows.length === 0 && !error && (
        <p className="text-sm text-slate-600 dark:text-neutral-400">No misconception events recorded yet.</p>
      )}
      {rows && rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-neutral-800">
          <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-neutral-800">
            <thead className="bg-slate-50 dark:bg-neutral-900">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-slate-700 dark:text-neutral-200">Misconception</th>
                <th className="px-3 py-2 text-left font-medium text-slate-700 dark:text-neutral-200">Question</th>
                <th className="px-3 py-2 text-right font-medium text-slate-700 dark:text-neutral-200">Triggers</th>
                <th className="px-3 py-2 text-right font-medium text-slate-700 dark:text-neutral-200">Students</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-neutral-800">
              {rows.map((r) => (
                <tr key={`${r.misconceptionId}-${r.questionId}`}>
                  <td className="px-3 py-2 text-slate-900 dark:text-neutral-100">{r.misconceptionName}</td>
                  <td className="max-w-md px-3 py-2 text-slate-700 dark:text-neutral-300">{r.questionStem}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-800 dark:text-neutral-200">
                    {r.triggerCount}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-800 dark:text-neutral-200">
                    {r.affectedStudents}
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
