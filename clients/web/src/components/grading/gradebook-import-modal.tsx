import { useCallback, useId, useState } from 'react'
import {
  deleteGradebookImportSession,
  postGradebookImportConfirm,
  postGradebookImportValidate,
  type GradebookImportValidateResponse,
} from '../../lib/courses-api'
import { toastMutationError, toastSaveOk } from '../../lib/lms-toast'

type ColRef = { id: string; title: string }

export function GradebookImportModal(props: {
  open: boolean
  courseCode: string
  columns: ColRef[]
  onClose: () => void
  onApplied: () => void
}) {
  const { open, courseCode, columns, onClose, onApplied } = props
  const baseId = useId()
  const [fileName, setFileName] = useState<string | null>(null)
  const [validating, setValidating] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [preview, setPreview] = useState<GradebookImportValidateResponse | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [ackBlind, setAckBlind] = useState(false)

  const colTitle = useCallback(
    (itemId: string) => columns.find((c) => c.id === itemId)?.title ?? itemId,
    [columns],
  )

  const reset = useCallback(() => {
    setFileName(null)
    setPreview(null)
    setFormError(null)
    setAckBlind(false)
  }, [])

  const handleClose = useCallback(() => {
    if (preview?.token) {
      void deleteGradebookImportSession(courseCode, preview.token)
    }
    reset()
    onClose()
  }, [courseCode, onClose, preview, reset])

  const onPickFile = useCallback(
    async (f: File | null) => {
      setFormError(null)
      setPreview(null)
      if (!f) {
        setFileName(null)
        return
      }
      setFileName(f.name)
      setValidating(true)
      try {
        const text = await f.text()
        const v = await postGradebookImportValidate(courseCode, text)
        setPreview(v)
        if (v.requireBlindManualHoldAck) setAckBlind(false)
      } catch (e: unknown) {
        setFormError(e instanceof Error ? e.message : 'Validation failed.')
      } finally {
        setValidating(false)
      }
    },
    [courseCode],
  )

  const onConfirm = useCallback(async () => {
    if (!preview?.token || !preview.confirmable) return
    if (preview.requireBlindManualHoldAck && !ackBlind) {
      setFormError('Confirm the blind-grading / manual-hold acknowledgement to continue.')
      return
    }
    setConfirming(true)
    setFormError(null)
    try {
      await postGradebookImportConfirm(courseCode, {
        token: preview.token,
        acknowledgeBlindManualHold: preview.requireBlindManualHoldAck ? true : undefined,
      })
      toastSaveOk('Grades imported')
      handleClose()
      onApplied()
    } catch (e: unknown) {
      toastMutationError(e instanceof Error ? e.message : 'Import failed.')
    } finally {
      setConfirming(false)
    }
  }, [ackBlind, courseCode, handleClose, onApplied, preview])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[95] flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="presentation"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Close import dialog"
        onClick={() => {
          if (!confirming) handleClose()
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${baseId}-title`}
        className="relative z-10 flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-900"
        onKeyDown={(ev) => {
          if (ev.key === 'Escape' && !confirming) handleClose()
        }}
      >
        <div className="border-b border-slate-200 px-4 py-3 dark:border-neutral-700">
          <h2 id={`${baseId}-title`} className="text-lg font-semibold text-slate-900 dark:text-neutral-100">
            Import grades from CSV
          </h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-neutral-400">
            Use a file exported from this course’s “Export CSV” (includes the metadata row). Review the
            preview, then confirm to apply. Import is logged as bulk import in the grade change history.
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <label className="block text-sm font-medium text-slate-800 dark:text-neutral-200" htmlFor={`${baseId}-file`}>
            CSV file
          </label>
          <input
            id={`${baseId}-file`}
            type="file"
            accept=".csv,text/csv"
            className="mt-1 block w-full text-sm text-slate-700 file:mr-2 file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-1.5 file:text-slate-800 dark:text-neutral-300 dark:file:bg-neutral-800 dark:file:text-neutral-100"
            disabled={validating || confirming}
            onChange={(ev) => {
              const f = ev.target.files?.[0] ?? null
              void onPickFile(f)
            }}
          />
          {fileName ? (
            <p className="mt-1 text-xs text-slate-500 dark:text-neutral-500" aria-live="polite">
              {validating ? 'Validating…' : `Selected: ${fileName}`}
            </p>
          ) : null}

          {formError ? (
            <p className="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">
              {formError}
            </p>
          ) : null}

          {preview && (
            <div className="mt-4 space-y-3">
              <div className="text-sm text-slate-600 dark:text-neutral-400" aria-live="polite">
                <span className="font-medium text-slate-800 dark:text-neutral-200">Summary:</span>{' '}
                {preview.stats.unchanged} unchanged, {preview.stats.updated} updated, {preview.stats.added} new
                cells, {preview.stats.errors} errors, {preview.stats.warnings} out-of-range warnings.
              </div>
              {preview.requireBlindManualHoldAck && preview.confirmable ? (
                <label className="flex items-start gap-2 text-sm text-slate-800 dark:text-neutral-200">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={ackBlind}
                    onChange={(e) => setAckBlind(e.target.checked)}
                    disabled={confirming}
                  />
                  <span>
                    This import changes grades for manual-hold, blind-graded work with identities not yet
                    revealed. I confirm I intend to update those scores.
                  </span>
                </label>
              ) : null}
              {preview.rows.length > 0 ? (
                <div
                  className="overflow-x-auto rounded-lg border border-slate-200 dark:border-neutral-700"
                  role="grid"
                  aria-label="Import preview: score changes by student and assignment"
                >
                  <table className="min-w-full divide-y divide-slate-200 text-left text-sm dark:divide-neutral-700">
                    <thead className="bg-slate-50 dark:bg-neutral-800/60">
                      <tr>
                        <th scope="col" className="px-2 py-2 font-medium">
                          Row
                        </th>
                        <th scope="col" className="px-2 py-2 font-medium">
                          Student
                        </th>
                        <th scope="col" className="px-2 py-2 font-medium">
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-neutral-800">
                      {preview.rows.map((row) => (
                        <tr key={row.rowIndex} className={row.error ? 'bg-red-50/80 dark:bg-red-950/30' : undefined}>
                          <td className="px-2 py-2 text-slate-600 dark:text-neutral-400">{row.rowIndex + 1}</td>
                          <td className="px-2 py-2 text-slate-800 dark:text-neutral-100">
                            {row.studentName || row.studentId || '—'}
                          </td>
                          <td className="px-2 py-2 text-slate-700 dark:text-neutral-300">
                            {row.error ? (
                              <span className="text-red-700 dark:text-red-300">{row.error}</span>
                            ) : (
                              <ul className="list-inside list-disc space-y-1">
                                {row.cells.map((c) => {
                                  const label = colTitle(c.itemId)
                                  const a =
                                    c.state === 'unchanged'
                                      ? 'unchanged'
                                      : c.state === 'error'
                                        ? 'invalid'
                                        : c.state
                                  const oob = c.outOfRange ? ' (above max; allowed with import)' : ''
                                  const aria = `Assignment ${label}: ${a}${oob}.`
                                  return (
                                    <li
                                      key={c.itemId + String(row.rowIndex)}
                                      aria-label={`${label}: ${a}${c.outOfRange ? ', score above maximum' : ''}`}
                                    >
                                      <span className="font-medium">{label}:</span> {c.previousScore ?? '—'} →{' '}
                                      {c.newScore || '—'}
                                      {c.outOfRange ? <span className="text-amber-800 dark:text-amber-200"> ⚠</span> : null}
                                      <span className="sr-only">{aria}</span>
                                    </li>
                                  )
                                })}
                              </ul>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-4 py-3 dark:border-neutral-700">
          <button
            type="button"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700/80"
            onClick={handleClose}
            disabled={confirming}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-indigo-500 dark:hover:bg-indigo-400"
            disabled={!preview?.confirmable || !preview?.token || confirming || validating}
            onClick={() => void onConfirm()}
          >
            {confirming ? 'Applying…' : 'Apply import'}
          </button>
        </div>
      </div>
    </div>
  )
}
