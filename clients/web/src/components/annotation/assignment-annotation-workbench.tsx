import { useCallback, useEffect, useState } from 'react'
import {
  deleteSubmissionAnnotation,
  downloadSubmissionAnnotatedPdf,
  fetchModuleAssignmentMySubmission,
  fetchModuleAssignmentSubmissions,
  fetchSubmissionAnnotations,
  postSubmissionAnnotation,
  uploadModuleAssignmentSubmissionFile,
  type ModuleAssignmentSubmissionApi,
  type PostSubmissionAnnotationInput,
  type SubmissionAnnotationApi,
} from '../../lib/courses-api'
import { AnnotationCommentPanel } from './annotation-comment-panel'
import { AnnotationToolbar, type AnnotationTool } from './annotation-toolbar'
import { AnnotationViewer } from './annotation-viewer'
import { SubmissionNavigator, type GradedFilter } from './submission-navigator'

export type AssignmentAnnotationWorkbenchProps = {
  courseCode: string
  itemId: string
  /** `staff` uses roster navigation; `student` loads only the viewer’s submission. */
  mode: 'staff' | 'student'
  submissionAllowsFile: boolean
}

export function AssignmentAnnotationWorkbench({
  courseCode,
  itemId,
  mode,
  submissionAllowsFile,
}: AssignmentAnnotationWorkbenchProps) {
  const [gradedFilter, setGradedFilter] = useState<GradedFilter>('all')
  const [submissions, setSubmissions] = useState<ModuleAssignmentSubmissionApi[]>([])
  const [idx, setIdx] = useState(0)
  const [mine, setMine] = useState<ModuleAssignmentSubmissionApi | null>(null)
  const [annotations, setAnnotations] = useState<SubmissionAnnotationApi[]>([])
  const [tool, setTool] = useState<AnnotationTool>('highlight')
  const [colour, setColour] = useState('#FFFF00')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const current: ModuleAssignmentSubmissionApi | null =
    mode === 'staff' ? (submissions[idx] ?? null) : mine

  const readOnly = mode === 'student'

  const reloadStaffList = useCallback(async () => {
    if (mode !== 'staff') return
    setLoadError(null)
    try {
      const list = await fetchModuleAssignmentSubmissions(courseCode, itemId, { graded: gradedFilter })
      setSubmissions(list)
      setIdx((i) => (list.length === 0 ? 0 : Math.min(i, list.length - 1)))
    } catch (e) {
      setSubmissions([])
      setLoadError(e instanceof Error ? e.message : 'Could not load submissions.')
    }
  }, [courseCode, itemId, gradedFilter, mode])

  const reloadMine = useCallback(async () => {
    if (mode !== 'student') return
    setLoadError(null)
    try {
      const row = await fetchModuleAssignmentMySubmission(courseCode, itemId)
      setMine(row)
    } catch (e) {
      setMine(null)
      setLoadError(e instanceof Error ? e.message : 'Could not load your submission.')
    }
  }, [courseCode, itemId, mode])

  useEffect(() => {
    if (mode === 'staff') void reloadStaffList()
    else void reloadMine()
  }, [mode, reloadMine, reloadStaffList])

  const reloadAnnotations = useCallback(async () => {
    if (!current?.id) {
      setAnnotations([])
      return
    }
    try {
      const list = await fetchSubmissionAnnotations(courseCode, itemId, current.id)
      setAnnotations(list)
    } catch {
      setAnnotations([])
    }
  }, [courseCode, itemId, current?.id])

  useEffect(() => {
    void reloadAnnotations()
  }, [reloadAnnotations])

  async function persistAnnotation(payload: PostSubmissionAnnotationInput) {
    if (!current?.id || readOnly) return
    setBusy(true)
    try {
      await postSubmissionAnnotation(courseCode, itemId, current.id, payload)
      await reloadAnnotations()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Could not save annotation.')
    } finally {
      setBusy(false)
    }
  }

  const promptBody = () => window.prompt('Comment (optional)')?.trim() ?? ''

  const onHighlightComplete = (page: number, rect: { x1: number; y1: number; x2: number; y2: number }) => {
    const body = promptBody()
    void persistAnnotation({
      clientId: crypto.randomUUID(),
      page,
      toolType: 'highlight',
      colour,
      coordsJson: rect,
      body: body || undefined,
    })
  }

  const onDrawComplete = (page: number, points: { x: number; y: number }[]) => {
    const body = promptBody()
    void persistAnnotation({
      clientId: crypto.randomUUID(),
      page,
      toolType: 'draw',
      colour,
      coordsJson: { points },
      body: body || undefined,
    })
  }

  const onPinComplete = (page: number, pt: { x: number; y: number }) => {
    const body = promptBody()
    void persistAnnotation({
      clientId: crypto.randomUUID(),
      page,
      toolType: 'pin',
      colour,
      coordsJson: pt,
      body: body || undefined,
    })
  }

  const onTextBoxComplete = (page: number, rect: { x1: number; y1: number; x2: number; y2: number }) => {
    const body = promptBody()
    void persistAnnotation({
      clientId: crypto.randomUUID(),
      page,
      toolType: 'text',
      colour,
      coordsJson: rect,
      body: body || undefined,
    })
  }

  async function onDeleteAnnotation(id: string) {
    if (!current?.id || readOnly) return
    if (!window.confirm('Delete this annotation?')) return
    setBusy(true)
    try {
      await deleteSubmissionAnnotation(courseCode, itemId, current.id, id)
      await reloadAnnotations()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Could not delete.')
    } finally {
      setBusy(false)
    }
  }

  async function onUploadStudentFile(file: File | null) {
    if (!file || mode !== 'student') return
    setBusy(true)
    try {
      await uploadModuleAssignmentSubmissionFile(courseCode, itemId, file)
      await reloadMine()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Upload failed.')
    } finally {
      setBusy(false)
    }
  }

  async function onDownloadAnnotated() {
    if (!current?.id) return
    setBusy(true)
    try {
      await downloadSubmissionAnnotatedPdf(courseCode, itemId, current.id)
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Download failed.')
    } finally {
      setBusy(false)
    }
  }

  if (!submissionAllowsFile) {
    return null
  }

  return (
    <section
      aria-label="Submission annotations"
      className="mt-8 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-neutral-700 dark:bg-neutral-950"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-neutral-50">
          {mode === 'staff' ? 'SpeedGrader' : 'Your submission'}
        </h2>
        {mode === 'staff' ? (
          <SubmissionNavigator
            submissions={submissions}
            index={idx}
            onIndexChange={setIdx}
            gradedFilter={gradedFilter}
            onGradedFilterChange={(f) => {
              setGradedFilter(f)
              setIdx(0)
            }}
            disabled={busy}
          />
        ) : null}
      </div>

      {loadError ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200">
          {loadError}
        </p>
      ) : null}

      {mode === 'student' ? (
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm font-medium text-slate-700 dark:text-neutral-200">
            <span className="mr-2">Upload file</span>
            <input
              type="file"
              accept=".pdf,image/png,image/jpeg,image/webp"
              disabled={busy}
              className="text-sm"
              onChange={(e) => void onUploadStudentFile(e.target.files?.[0] ?? null)}
            />
          </label>
        </div>
      ) : null}

      {current?.attachmentMimeType === 'application/pdf' && current.id ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-900 dark:hover:bg-neutral-800"
            onClick={() => void onDownloadAnnotated()}
          >
            Download annotated PDF
          </button>
        </div>
      ) : null}

      <AnnotationToolbar
        tool={tool}
        onToolChange={setTool}
        colour={colour}
        onColourChange={setColour}
        disabled={busy || !current?.attachmentFileId}
        readOnly={readOnly}
      />

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          <AnnotationViewer
            filePath={current?.attachmentContentPath ?? null}
            mimeType={current?.attachmentMimeType ?? null}
            readOnly={readOnly}
            tool={tool}
            colour={colour}
            annotations={annotations}
            onHighlightComplete={readOnly ? undefined : onHighlightComplete}
            onDrawComplete={readOnly ? undefined : onDrawComplete}
            onPinComplete={readOnly ? undefined : onPinComplete}
            onTextBoxComplete={readOnly ? undefined : onTextBoxComplete}
          />
        </div>
        <AnnotationCommentPanel
          annotations={annotations}
          selectedId={selectedId}
          onSelect={setSelectedId}
          readOnly={readOnly}
          onDelete={readOnly ? undefined : onDeleteAnnotation}
        />
      </div>
    </section>
  )
}
