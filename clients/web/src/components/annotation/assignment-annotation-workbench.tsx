import { useCallback, useEffect, useState } from 'react'
import {
  deleteSubmissionAnnotation,
  downloadSubmissionAnnotatedPdf,
  fetchModuleAssignmentMySubmission,
  fetchModuleAssignmentSubmissions,
  fetchProvisionalGrades,
  fetchSubmissionAnnotations,
  fetchSubmissionFeedbackMedia,
  fetchSubmissionOriginality,
  fetchSubmissionOriginalityEmbedUrl,
  postProvisionalGrade,
  postSubmissionAnnotation,
  revealModuleAssignmentIdentities,
  uploadModuleAssignmentSubmissionFile,
  type ModuleAssignmentSubmissionApi,
  type OriginalityReportApi,
  type PostSubmissionAnnotationInput,
  type SubmissionAnnotationApi,
  type SubmissionFeedbackMediaApi,
} from '../../lib/courses-api'
import { OriginalityBadge } from '../grading/OriginalityBadge'
import { OriginalityReportViewer } from '../grading/OriginalityReportViewer'
import { getJwtSubject } from '../../lib/auth'
import { AnnotationCommentPanel } from './annotation-comment-panel'
import { AnnotationToolbar, type AnnotationTool } from './annotation-toolbar'
import { AnnotationViewer } from './annotation-viewer'
import { FeedbackMediaPlayerList } from './FeedbackMediaPlayer'
import { FeedbackMediaRecorder } from './FeedbackMediaRecorder'
import { SubmissionNavigator, type GradedFilter } from './submission-navigator'

export type AssignmentAnnotationWorkbenchProps = {
  courseCode: string
  itemId: string
  /** `staff` uses roster navigation; `student` loads only the viewer’s submission. */
  mode: 'staff' | 'student'
  submissionAllowsFile: boolean
  /**
   * When true, show document annotation (requires file upload allowed). Default: same as
   * `submissionAllowsFile` for backwards compatibility.
   */
  annotationsActive?: boolean
  /** Server `FEEDBACK_MEDIA_ENABLED` — A/V feedback (plan 3.2). */
  feedbackMediaEnabled?: boolean
  /** Plan 3.3 — show blind grading banner and anonymised labels. */
  blindGradingActive?: boolean
  /** Course creator may reveal identities (from assignment GET). */
  canRevealIdentities?: boolean
  /** Refresh assignment metadata after reveal. */
  onAfterRevealIdentities?: () => void
  /** Plan 3.4 — show provisional score entry for listed graders. */
  moderatedGradingActive?: boolean
  assignmentPointsWorth?: number | null
  provisionalGraderUserIds?: string[]
  /** Plan 3.5 — from assignment settings; when not `disabled`, originality API is polled. */
  originalityDetection?: 'disabled' | 'plagiarism' | 'ai' | 'both'
}

export function AssignmentAnnotationWorkbench({
  courseCode,
  itemId,
  mode,
  submissionAllowsFile,
  annotationsActive: annotationsActiveProp,
  feedbackMediaEnabled = false,
  blindGradingActive = false,
  canRevealIdentities = false,
  onAfterRevealIdentities,
  moderatedGradingActive = false,
  assignmentPointsWorth = null,
  provisionalGraderUserIds = [],
  originalityDetection = 'disabled',
}: AssignmentAnnotationWorkbenchProps) {
  const annotationsActive = annotationsActiveProp ?? submissionAllowsFile
  const [panel, setPanel] = useState<'document' | 'media'>('document')
  const [mediaItems, setMediaItems] = useState<SubmissionFeedbackMediaApi[]>([])
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
  const [provisionalInput, setProvisionalInput] = useState('')
  const [provisionalBusy, setProvisionalBusy] = useState(false)
  const [originalityReports, setOriginalityReports] = useState<OriginalityReportApi[] | null>(null)
  const [originalityViewerOpen, setOriginalityViewerOpen] = useState(false)
  const [originalityEmbedUrl, setOriginalityEmbedUrl] = useState<string | null>(null)

  const originalityActive = originalityDetection !== 'disabled'

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

  const myUid = getJwtSubject()
  const isListedGrader = Boolean(
    mode === 'staff' &&
      moderatedGradingActive &&
      myUid &&
      provisionalGraderUserIds.includes(myUid),
  )

  useEffect(() => {
    if (!isListedGrader || !current?.id) {
      setProvisionalInput('')
      return
    }
    let cancel = false
    void (async () => {
      try {
        const rows = await fetchProvisionalGrades(courseCode, itemId)
        const mine = rows.find((r) => r.submissionId === current.id && r.graderId === myUid)
        if (!cancel) setProvisionalInput(mine ? String(mine.score) : '')
      } catch {
        if (!cancel) setProvisionalInput('')
      }
    })()
    return () => {
      cancel = true
    }
  }, [courseCode, itemId, current?.id, isListedGrader, myUid])

  const reloadAnnotations = useCallback(async () => {
    if (!annotationsActive || !current?.id) {
      setAnnotations([])
      return
    }
    try {
      const list = await fetchSubmissionAnnotations(courseCode, itemId, current.id)
      setAnnotations(list)
    } catch {
      setAnnotations([])
    }
  }, [annotationsActive, courseCode, itemId, current?.id])

  const reloadMedia = useCallback(async () => {
    if (!feedbackMediaEnabled || !current?.id) {
      setMediaItems([])
      return
    }
    try {
      const list = await fetchSubmissionFeedbackMedia(courseCode, itemId, current.id)
      setMediaItems(list)
    } catch {
      setMediaItems([])
    }
  }, [courseCode, current?.id, feedbackMediaEnabled, itemId])

  useEffect(() => {
    void reloadAnnotations()
  }, [reloadAnnotations])

  useEffect(() => {
    void reloadMedia()
  }, [reloadMedia])

  const reloadOriginality = useCallback(async () => {
    if (!originalityActive || !current?.id) {
      setOriginalityReports(null)
      return
    }
    try {
      const reps = await fetchSubmissionOriginality(courseCode, itemId, current.id)
      setOriginalityReports(reps ?? [])
    } catch {
      setOriginalityReports([])
    }
  }, [courseCode, itemId, current?.id, originalityActive])

  useEffect(() => {
    void reloadOriginality()
  }, [reloadOriginality])

  useEffect(() => {
    if (!originalityActive || !current?.id) return
    const t = window.setInterval(() => void reloadOriginality(), 8000)
    return () => window.clearInterval(t)
  }, [current?.id, originalityActive, reloadOriginality])

  useEffect(() => {
    if (annotationsActive && !feedbackMediaEnabled) setPanel('document')
    if (!annotationsActive && feedbackMediaEnabled) setPanel('media')
  }, [annotationsActive, feedbackMediaEnabled])

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

  async function onRevealIdentities() {
    if (
      !window.confirm(
        'You are about to unmask student identities for this assignment. This cannot be undone. Continue?',
      )
    ) {
      return
    }
    setBusy(true)
    try {
      try {
        await revealModuleAssignmentIdentities(courseCode, itemId, { force: false })
      } catch (e) {
        const msg = e instanceof Error ? e.message : ''
        if (
          msg.toLowerCase().includes('ungraded') &&
          window.confirm(
            'Some submissions are still ungraded. Reveal identities anyway? This cannot be undone.',
          )
        ) {
          await revealModuleAssignmentIdentities(courseCode, itemId, { force: true })
        } else {
          throw e
        }
      }
      onAfterRevealIdentities?.()
      if (mode === 'staff') void reloadStaffList()
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not reveal identities.')
    } finally {
      setBusy(false)
    }
  }

  async function onOpenOriginalityReport() {
    if (!current?.id) return
    setBusy(true)
    try {
      let url = await fetchSubmissionOriginalityEmbedUrl(courseCode, itemId, current.id)
      if (!/^https?:\/\//i.test(url)) {
        url = `${window.location.origin}${url.startsWith('/') ? '' : '/'}${url}`
      }
      setOriginalityEmbedUrl(url)
      setOriginalityViewerOpen(true)
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'No originality report is available yet.')
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

  const showDocPanel = annotationsActive
  const showMediaPanel = feedbackMediaEnabled
  const both = showDocPanel && showMediaPanel

  if (!showDocPanel && !showMediaPanel) {
    return null
  }

  return (
    <section
      aria-label="Submission annotations"
      className="mt-8 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-neutral-700 dark:bg-neutral-950"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-neutral-50">
            {mode === 'staff' ? 'SpeedGrader' : 'Your submission'}
          </h2>
          {originalityActive && originalityReports && originalityReports.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <OriginalityBadge reports={originalityReports} />
              {mode === 'staff' ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onOpenOriginalityReport()}
                  className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-indigo-700 hover:bg-slate-50 disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-950 dark:text-indigo-300 dark:hover:bg-neutral-900"
                >
                  View report
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        {mode === 'staff' ? (
          <div className="flex flex-wrap items-center gap-2">
            {canRevealIdentities ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void onRevealIdentities()}
                className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-950 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100 dark:hover:bg-amber-900/60"
              >
                Reveal identities
              </button>
            ) : null}
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
              currentSubmissionDisplayLabel={
                current?.blindLabel ??
                (submissions.length > 0 ? `Submission ${idx + 1}` : undefined)
              }
              anonymisedAriaLabel={
                current?.blindLabel
                  ? `Anonymised student, label ${current.blindLabel}`
                  : undefined
              }
            />
          </div>
        ) : null}
      </div>

      {originalityEmbedUrl ? (
        <OriginalityReportViewer
          open={originalityViewerOpen}
          onClose={() => {
            setOriginalityViewerOpen(false)
            setOriginalityEmbedUrl(null)
          }}
          embedUrl={originalityEmbedUrl}
        />
      ) : null}

      {mode === 'staff' && blindGradingActive ? (
        <p
          role="status"
          className="rounded-lg border border-indigo-200 bg-indigo-50/90 px-3 py-2 text-sm text-indigo-950 dark:border-indigo-900/60 dark:bg-indigo-950/40 dark:text-indigo-100"
        >
          Blind grading is active — student identities are hidden. Use anonymised labels until you
          reveal identities.
        </p>
      ) : null}

      {isListedGrader && current ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50/90 px-3 py-2 dark:border-neutral-600 dark:bg-neutral-900/60">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-neutral-400">
            Provisional score
          </p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="text-sm text-slate-700 dark:text-neutral-200" htmlFor="prov-score">
              Points (0–{assignmentPointsWorth ?? '—'})
            </label>
            <input
              id="prov-score"
              type="number"
              min={0}
              max={assignmentPointsWorth ?? undefined}
              value={provisionalInput}
              onChange={(e) => setProvisionalInput(e.target.value)}
              className="w-28 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-neutral-600 dark:bg-neutral-950"
            />
            <button
              type="button"
              disabled={provisionalBusy}
              onClick={() => {
                if (!current?.id) return
                const n = Number(provisionalInput)
                if (!Number.isFinite(n) || n < 0) return
                setProvisionalBusy(true)
                void (async () => {
                  try {
                    await postProvisionalGrade(courseCode, itemId, current.id, { score: n })
                  } finally {
                    setProvisionalBusy(false)
                  }
                })()
              }}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {provisionalBusy ? 'Saving…' : 'Save provisional'}
            </button>
          </div>
        </div>
      ) : null}

      {both ? (
        <div
          className="flex flex-wrap gap-1 border-b border-slate-200 pb-1 dark:border-neutral-600"
          role="tablist"
        >
          <button
            type="button"
            role="tab"
            aria-selected={panel === 'document'}
            className={`rounded-t-md px-3 py-1.5 text-sm font-medium ${
              panel === 'document'
                ? 'bg-slate-100 text-slate-900 dark:bg-neutral-800 dark:text-neutral-50'
                : 'text-slate-600 hover:bg-slate-50 dark:text-neutral-400 dark:hover:bg-neutral-800/60'
            }`}
            onClick={() => setPanel('document')}
          >
            Annotations
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={panel === 'media'}
            className={`rounded-t-md px-3 py-1.5 text-sm font-medium ${
              panel === 'media'
                ? 'bg-slate-100 text-slate-900 dark:bg-neutral-800 dark:text-neutral-50'
                : 'text-slate-600 hover:bg-slate-50 dark:text-neutral-400 dark:hover:bg-neutral-800/60'
            }`}
            onClick={() => setPanel('media')}
          >
            Media feedback
          </button>
        </div>
      ) : null}

      {loadError ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200">
          {loadError}
        </p>
      ) : null}

      {showDocPanel && mode === 'student' && submissionAllowsFile ? (
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

      {showDocPanel && panel === 'document' && current?.attachmentMimeType === 'application/pdf' && current.id ? (
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

      {showDocPanel && panel === 'document' ? (
        <>
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
        </>
      ) : null}

      {showMediaPanel && (both ? panel === 'media' : true) && current?.id ? (
        <div className="space-y-4" aria-label="Instructor media feedback">
          {mode === 'staff' && current.id ? (
            <FeedbackMediaRecorder
              courseCode={courseCode}
              itemId={itemId}
              submissionId={current.id}
              onComplete={() => void reloadMedia()}
            />
          ) : null}
          <FeedbackMediaPlayerList
            courseCode={courseCode}
            itemId={itemId}
            submissionId={current.id}
            items={mediaItems}
            readOnly={readOnly}
            onChanged={() => void reloadMedia()}
          />
        </div>
      ) : null}
    </section>
  )
}
