import { type ChangeEvent, useRef, useState } from 'react'
import { Download, Upload } from 'lucide-react'
import { usePermissions } from '../../context/usePermissions'
import {
  courseItemCreatePermission,
  fetchCourseExport,
  postCourseImport,
  type CourseBundleImportMode,
} from '../../lib/coursesApi'
export function CourseExportImportSection({ courseCode }: { courseCode: string }) {
  const { allows, loading: permLoading } = usePermissions()
  const canEdit = !permLoading && allows(courseItemCreatePermission(courseCode))
  const fileRef = useRef<HTMLInputElement>(null)
  const [importMode, setImportMode] = useState<CourseBundleImportMode>('erase')
  const [busy, setBusy] = useState<'idle' | 'exporting' | 'importing'>('idle')
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  async function onExport() {
    setFeedback(null)
    setBusy('exporting')
    try {
      const data = await fetchCourseExport(courseCode)
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${courseCode}-course-export.json`
      a.click()
      URL.revokeObjectURL(url)
      setFeedback({ kind: 'ok', text: 'Export downloaded.' })
    } catch (e) {
      setFeedback({
        kind: 'err',
        text: e instanceof Error ? e.message : 'Export failed.',
      })
    } finally {
      setBusy('idle')
    }
  }

  async function onPickImportFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setFeedback(null)
    setBusy('importing')
    try {
      const text = await file.text()
      let parsed: unknown
      try {
        parsed = JSON.parse(text) as unknown
      } catch {
        throw new Error('That file is not valid JSON.')
      }
      if (typeof parsed !== 'object' || parsed === null) {
        throw new Error('Import file must contain a JSON object.')
      }
      await postCourseImport(courseCode, {
        mode: importMode,
        export: parsed as Record<string, unknown>,
      })
      setFeedback({ kind: 'ok', text: 'Import completed successfully.' })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Import failed.'
      setFeedback({ kind: 'err', text: msg })
    } finally {
      setBusy('idle')
    }
  }

  if (!canEdit) {
    return (
      <p className="text-sm text-slate-600 dark:text-slate-400">
        You need permission to edit course modules to export or import course content.
      </p>
    )
  }

  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-900/5 dark:border-slate-700 dark:bg-slate-900/40">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Export</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Download the full course bundle as one JSON file: syllabus, modules, pages,
          assignments, quizzes, grading groups, and course appearance settings (not enrollments or
          learner data).
        </p>
        <div className="mt-4">
          <button
            type="button"
            onClick={() => void onExport()}
            disabled={busy !== 'idle'}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Download className="h-4 w-4" aria-hidden />
            {busy === 'exporting' ? 'Preparing…' : 'Download JSON export'}
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-900/5 dark:border-slate-700 dark:bg-slate-900/40">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Import</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Choose a JSON file produced by this course&apos;s export (or another course you own).
          The file&apos;s <code className="text-xs">courseCode</code> must match this course.
        </p>

        <fieldset className="mt-4 space-y-3">
          <legend className="text-sm font-medium text-slate-800 dark:text-slate-200">
            Import mode
          </legend>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-600">
            <input
              type="radio"
              name="importMode"
              className="mt-1"
              checked={importMode === 'erase'}
              onChange={() => setImportMode('erase')}
            />
            <span>
              <span className="block text-sm font-medium text-slate-900 dark:text-slate-100">
                Erase and import
              </span>
              <span className="mt-0.5 block text-sm text-slate-500 dark:text-slate-400">
                Remove all modules and related content, then apply the file. Also replaces
                syllabus, grading groups, and course settings from the file.
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-600">
            <input
              type="radio"
              name="importMode"
              className="mt-1"
              checked={importMode === 'mergeAdd'}
              onChange={() => setImportMode('mergeAdd')}
            />
            <span>
              <span className="block text-sm font-medium text-slate-900 dark:text-slate-100">
                Add difference (merge)
              </span>
              <span className="mt-0.5 block text-sm text-slate-500 dark:text-slate-400">
                Keep existing content. Only add syllabus sections, assignment groups, and outline
                items whose ids are not already present, with bodies for those new items only.
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-600">
            <input
              type="radio"
              name="importMode"
              className="mt-1"
              checked={importMode === 'overwrite'}
              onChange={() => setImportMode('overwrite')}
            />
            <span>
              <span className="block text-sm font-medium text-slate-900 dark:text-slate-100">
                Overwrite / sync
              </span>
              <span className="mt-0.5 block text-sm text-slate-500 dark:text-slate-400">
                Update this course from the file: replace syllabus and grading, refresh settings,
                upsert every item in the file, remove outline items not listed in the file, and
                refresh all module bodies from the file.
              </span>
            </span>
          </label>
        </fieldset>

        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => void onPickImportFile(e)}
        />
        <div className="mt-4">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy !== 'idle'}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
          >
            <Upload className="h-4 w-4" aria-hidden />
            {busy === 'importing' ? 'Importing…' : 'Choose JSON file…'}
          </button>
        </div>
      </section>

      {feedback && (
        <p
          className={
            feedback.kind === 'err'
              ? 'text-sm text-rose-700 dark:text-rose-400'
              : 'text-sm text-emerald-700 dark:text-emerald-400'
          }
          role="status"
        >
          {feedback.text}
        </p>
      )}
    </div>
  )
}
