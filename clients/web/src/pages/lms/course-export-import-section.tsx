import { type ChangeEvent, useRef, useState } from 'react'
import { Download, GraduationCap, Upload } from 'lucide-react'
import { BookLoader } from '../../components/quiz/book-loader'
import { usePermissions } from '../../context/use-permissions'
import {
  CANVAS_IMPORT_INCLUDE_ALL,
  courseItemCreatePermission,
  fetchCourseExport,
  postCourseImport,
  postCourseImportCanvas,
  type CanvasImportInclude,
  type CourseBundleImportMode,
} from '../../lib/courses-api'
export function CourseExportImportSection({ courseCode }: { courseCode: string }) {
  const { allows, loading: permLoading } = usePermissions()
  const canEdit = !permLoading && allows(courseItemCreatePermission(courseCode))
  const fileRef = useRef<HTMLInputElement>(null)
  const [importMode, setImportMode] = useState<CourseBundleImportMode>('erase')
  const [busy, setBusy] = useState<
    'idle' | 'exporting' | 'importing' | 'importingCanvas'
  >('idle')
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [canvasBaseUrl, setCanvasBaseUrl] = useState('')
  const [canvasCourseId, setCanvasCourseId] = useState('')
  const [canvasToken, setCanvasToken] = useState('')
  const [canvasInclude, setCanvasInclude] = useState<CanvasImportInclude>(CANVAS_IMPORT_INCLUDE_ALL)
  const [canvasImportStatus, setCanvasImportStatus] = useState<{
    key: number
    text: string
  } | null>(null)

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

  async function onCanvasImport() {
    setFeedback(null)
    setCanvasImportStatus(null)
    setBusy('importingCanvas')
    try {
      await postCourseImportCanvas(
        courseCode,
        {
          mode: importMode,
          canvasBaseUrl: canvasBaseUrl.trim(),
          canvasCourseId: canvasCourseId.trim(),
          accessToken: canvasToken.trim(),
          include: canvasInclude,
        },
        (message) => {
          setCanvasImportStatus((prev) => ({
            key: (prev?.key ?? 0) + 1,
            text: message,
          }))
        },
      )
      setFeedback({
        kind: 'ok',
        text: 'Canvas course imported successfully. Reload the course if modules look stale.',
      })
      setCanvasToken('')
    } catch (e) {
      setFeedback({
        kind: 'err',
        text: e instanceof Error ? e.message : 'Canvas import failed.',
      })
    } finally {
      setBusy('idle')
      setCanvasImportStatus(null)
    }
  }

  if (!canEdit) {
    return (
      <p className="text-sm text-slate-600 dark:text-neutral-400">
        You need permission to edit course modules to export or import course content.
      </p>
    )
  }

  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-900/5 dark:border-neutral-700 dark:bg-neutral-900/40">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-neutral-100">Export</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
          Download the full course bundle as one JSON file: syllabus, modules, pages,
          assignments, quizzes, grading groups, roster emails and roles, and course appearance
          settings.
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

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-900/5 dark:border-neutral-700 dark:bg-neutral-900/40">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-neutral-100">Import</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
          Bring content into this course from Canvas (API) or from a JSON export file. The import
          mode below applies to both paths. For JSON files, the{' '}
          <code className="text-xs">courseCode</code> in the file is informational only.
        </p>

        <fieldset className="mt-4 space-y-3">
          <legend className="text-sm font-medium text-slate-800 dark:text-neutral-200">
            Import mode
          </legend>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 dark:border-neutral-600">
            <input
              type="radio"
              name="importMode"
              className="mt-1"
              checked={importMode === 'erase'}
              onChange={() => setImportMode('erase')}
            />
            <span>
              <span className="block text-sm font-medium text-slate-900 dark:text-neutral-100">
                Erase and import
              </span>
              <span className="mt-0.5 block text-sm text-slate-500 dark:text-neutral-400">
                Remove all modules and related content, then apply the file. Also replaces
                syllabus, grading groups, and course settings from the file. If the bundle includes
                an <code className="text-xs">enrollments</code> array, the roster is replaced except
                for the course creator’s teacher enrollment.
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 dark:border-neutral-600">
            <input
              type="radio"
              name="importMode"
              className="mt-1"
              checked={importMode === 'mergeAdd'}
              onChange={() => setImportMode('mergeAdd')}
            />
            <span>
              <span className="block text-sm font-medium text-slate-900 dark:text-neutral-100">
                Add difference (merge)
              </span>
              <span className="mt-0.5 block text-sm text-slate-500 dark:text-neutral-400">
                Keep existing content. Only add syllabus sections, assignment groups, and outline
                items whose ids are not already present, with bodies for those new items only. Existing
                syllabus text is never replaced in this mode (use erase or overwrite to refresh it).
                If the bundle includes enrollments, missing roster rows are added; new users are
                created by email when needed.
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 dark:border-neutral-600">
            <input
              type="radio"
              name="importMode"
              className="mt-1"
              checked={importMode === 'overwrite'}
              onChange={() => setImportMode('overwrite')}
            />
            <span>
              <span className="block text-sm font-medium text-slate-900 dark:text-neutral-100">
                Overwrite / sync
              </span>
              <span className="mt-0.5 block text-sm text-slate-500 dark:text-neutral-400">
                Update this course from the file: replace syllabus and grading, refresh settings,
                upsert every item in the file, remove outline items not listed in the file, and
                refresh all module bodies from the file. If the bundle includes enrollments, the
                roster is replaced except for the course creator’s teacher enrollment.
              </span>
            </span>
          </label>
        </fieldset>

        <div className="mt-8 border-t border-slate-200 pt-8 dark:border-neutral-600">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-neutral-100">
            From Canvas LMS
          </h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
            Use a Canvas personal access token. Choose what to pull below (all are on by default).
            We map Canvas into this course; anyone with a matching email gets enrolled when
            enrollments are included; if they do not have a Lexters account yet, one is created with
            a random password (they can use password reset to sign in, if your deployment offers it).
            The token is sent once for the import (HTTPS and WebSocket) and is not stored.
          </p>
          <fieldset className="mt-4 rounded-xl border border-slate-200 p-4 dark:border-neutral-600">
            <legend className="px-1 text-xs font-medium text-slate-700 dark:text-neutral-300">
              Import from Canvas
            </legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {(
                [
                  ['modules', 'Modules', 'Outline, wiki pages, discussions, links, and other module items (not assignments/quizzes).'] as const,
                  ['assignments', 'Assignments', 'Assignment prompts, due dates, and submission settings.'] as const,
                  ['quizzes', 'Quizzes', 'Quizzes and questions when Canvas exposes them.'] as const,
                  ['enrollments', 'Enrollments', 'Active and invited roster (matched by email).'] as const,
                  ['grades', 'Grades', 'Assignment groups and weighting from Canvas (gradebook layout).'] as const,
                  ['settings', 'Settings', 'Course title, overview, dates, visibility, and syllabus sections.'] as const,
                ] as const
              ).map(([key, label, hint]) => (
                <label
                  key={key}
                  className="flex cursor-pointer items-start gap-2 rounded-lg border border-transparent px-1 py-1 hover:border-slate-200 hover:bg-slate-50 dark:hover:border-neutral-600 dark:hover:bg-neutral-800/60"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={canvasInclude[key]}
                    onChange={(e) =>
                      setCanvasInclude((prev) => ({ ...prev, [key]: e.target.checked }))
                    }
                  />
                  <span>
                    <span className="block text-sm font-medium text-slate-900 dark:text-neutral-100">
                      {label}
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-500 dark:text-neutral-500">
                      {hint}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="text-xs font-medium text-slate-600 dark:text-neutral-400">
                Canvas base URL
              </span>
              <input
                type="url"
                value={canvasBaseUrl}
                onChange={(e) => setCanvasBaseUrl(e.target.value)}
                placeholder="https://yourschool.instructure.com"
                autoComplete="off"
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-inner outline-none ring-indigo-500/0 transition focus:border-indigo-400 focus:ring-2 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600 dark:text-neutral-400">
                Canvas course ID
              </span>
              <input
                type="text"
                inputMode="numeric"
                value={canvasCourseId}
                onChange={(e) => setCanvasCourseId(e.target.value)}
                placeholder="e.g. 1234567"
                autoComplete="off"
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-inner outline-none ring-indigo-500/0 transition focus:border-indigo-400 focus:ring-2 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600 dark:text-neutral-400">
                Access token
              </span>
              <input
                type="password"
                value={canvasToken}
                onChange={(e) => setCanvasToken(e.target.value)}
                placeholder="Canvas API token"
                autoComplete="off"
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-inner outline-none ring-indigo-500/0 transition focus:border-indigo-400 focus:ring-2 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
              />
            </label>
          </div>
          <p className="mt-3 text-xs text-slate-500 dark:text-neutral-500">
            In Canvas: Account or Profile → Settings → New access token. Use a token with
            permission to read the course, assignments, pages, quizzes, enrollments, and the course
            user list (roster).
          </p>
          <div className="mt-4">
            <button
              type="button"
              onClick={() => void onCanvasImport()}
              disabled={
                busy !== 'idle' ||
                !canvasBaseUrl.trim() ||
                !canvasCourseId.trim() ||
                !canvasToken.trim()
              }
              aria-busy={busy === 'importingCanvas'}
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy === 'importingCanvas' ? (
                <span
                  className="inline-flex shrink-0 items-center justify-center overflow-visible"
                  aria-hidden
                >
                  <span className="inline-flex origin-center translate-y-[4px] scale-[0.3]">
                    <BookLoader className="![--quiz-book-loader-color:rgba(255,255,255,0.92)]" />
                  </span>
                </span>
              ) : (
                <GraduationCap className="h-4 w-4 shrink-0" aria-hidden />
              )}
              {busy === 'importingCanvas' ? 'Importing from Canvas…' : 'Import from Canvas'}
            </button>
          </div>
          {canvasImportStatus && (
            <p
              key={canvasImportStatus.key}
              className="canvas-import-status-in mt-3 text-sm text-slate-600 dark:text-neutral-400"
              role="status"
              aria-live="polite"
            >
              {canvasImportStatus.text}
            </p>
          )}
        </div>

        <div className="mt-8 border-t border-slate-200 pt-8 dark:border-neutral-600">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-neutral-100">
            From JSON export file
          </h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
            Choose a JSON file produced by this app or another environment running the same export
            format.
          </p>
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
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700"
            >
              <Upload className="h-4 w-4" aria-hidden />
              {busy === 'importing' ? 'Importing…' : 'Choose JSON file…'}
            </button>
          </div>
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
