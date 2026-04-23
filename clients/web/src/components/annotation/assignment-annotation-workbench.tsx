import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  deleteSubmissionAnnotation,
  downloadSubmissionAnnotatedPdf,
  fetchModuleAssignmentMySubmission,
  fetchModuleAssignmentSubmissions,
  fetchProvisionalGrades,
  fetchSubmissionAnnotations,
  fetchSubmissionFeedbackMedia,
  fetchSubmissionOriginality,
  fetchSubmissionOriginalityEmbed,
  fetchSubmissionVersions,
  postProvisionalGrade,
  postRequestAssignmentRevision,
  postSubmissionAnnotation,
  revealModuleAssignmentIdentities,
  uploadModuleAssignmentSubmissionFile,
  type ModuleAssignmentSubmissionApi,
  type OriginalityReportApi,
  type OriginalityReportSummary,
  type PostSubmissionAnnotationInput,
  type SubmissionAnnotationApi,
  type SubmissionFeedbackMediaApi,
  type SubmissionVersionApi,
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
  /** Assignment title (in-app message / banners). */
  assignmentTitle?: string
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
  /** Plan 3.13 — server `RESUBMISSION_WORKFLOW_ENABLED`. */
  resubmissionWorkflowEnabled?: boolean
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
  assignmentTitle = 'Assignment',
  resubmissionWorkflowEnabled = false,
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
  const [originalitySummary, setOriginalitySummary] = useState<OriginalityReportSummary | null>(null)
  const [originalityViewSummaryOnly, setOriginalityViewSummaryOnly] = useState(false)
  const [submissionVersions, setSubmissionVersions] = useState<SubmissionVersionApi[]>([])
  const [viewVersionNumber, setViewVersionNumber] = useState<number | null>(null)
  const [revisionFormOpen, setRevisionFormOpen] = useState(false)
  const [revDueLocal, setRevDueLocal] = useState('')
  const [revFeedback, setRevFeedback] = useState('')
  const [revisionBusy, setRevisionBusy] = useState(false)
  const [deadlineNow, setDeadlineNow] = useState(() => Date.now())

  const originalityActive = originalityDetection !== 'disabled'

  const current: ModuleAssignmentSubmissionApi | null =
    mode === 'staff' ? (submissions[idx] ?? null) : mine
  const readOnly = mode === 'student'

  useEffect(() => {
    setViewVersionNumber(null)
  }, [current?.id])

  useEffect(() => {
    if (!resubmissionWorkflowEnabled || mode !== 'staff' || !current?.id) {
      setSubmissionVersions([])
      return
    }
    let c = true
    void (async () => {
      try {
        const v = await fetchSubmissionVersions(courseCode, itemId, current.id)
        if (!c) return
        setSubmissionVersions(v)
        setViewVersionNumber((prev) => {
          if (prev == null) return v.length > 0 ? (v[v.length - 1]?.versionNumber ?? null) : null
          return v.some((x) => x.versionNumber === prev) ? prev : (v[v.length - 1]?.versionNumber ?? null)
        })
      } catch {
        if (c) setSubmissionVersions([])
      }
    })()
    return () => {
      c = false
    }
  }, [resubmissionWorkflowEnabled, courseCode, itemId, mode, current?.id])

  const versionForView = useMemo((): SubmissionVersionApi | null => {
    if (mode !== 'staff' || !resubmissionWorkflowEnabled || !current?.id || submissionVersions.length === 0) {
      return null
    }
    const n = viewVersionNumber ?? submissionVersions[submissionVersions.length - 1]?.versionNumber
    if (n == null) return null
    return submissionVersions.find((v) => v.versionNumber === n) ?? null
  }, [current?.id, mode, resubmissionWorkflowEnabled, submissionVersions, viewVersionNumber])

  const viewIsLatest =
    versionForView == null
      ? true
      : versionForView.versionNumber === (current?.versionNumber ?? 0)

  const displayFilePath = versionForView ? versionForView.attachmentContentPath : current?.attachmentContentPath
  const displayMimeType = versionForView ? versionForView.attachmentMimeType : current?.attachmentMimeType
  const readOnlyDocument =
    readOnly || (mode === 'staff' && resubmissionWorkflowEnabled && !viewIsLatest)

  useEffect(() => {
    if (mode === 'student' && mine?.resubmissionRequested && mine.revisionDueAt) {
      const t = window.setInterval(() => setDeadlineNow(Date.now()), 15_000)
      return () => clearInterval(t)
    }
    return
  }, [mode, mine?.resubmissionRequested, mine?.revisionDueAt])

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
    if (mode === 'staff' && resubmissionWorkflowEnabled && !viewIsLatest) {
      setAnnotations([])
      return
    }
    try {
      const list = await fetchSubmissionAnnotations(courseCode, itemId, current.id)
      setAnnotations(list)
    } catch {
      setAnnotations([])
    }
  }, [
    annotationsActive,
    courseCode,
    itemId,
    current?.id,
    mode,
    resubmissionWorkflowEnabled,
    viewIsLatest,
  ])

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
    if (!current?.id || readOnlyDocument) return
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
    if (!current?.id || readOnlyDocument) return
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

  async function onRequestRevision() {
    if (!current?.id) return
    setRevisionBusy(true)
    try {
      let revisionDueAt: string | null = null
      if (revDueLocal.trim()) {
        const d = new Date(revDueLocal)
        if (Number.isNaN(d.getTime())) {
          window.alert('Use a valid date and time for the revision deadline.')
          return
        }
        revisionDueAt = d.toISOString()
      }
      await postRequestAssignmentRevision(courseCode, itemId, current.id, {
        revisionDueAt,
        revisionFeedback: revFeedback.trim() || null,
      })
      setRevisionFormOpen(false)
      setRevDueLocal('')
      setRevFeedback('')
      await reloadStaffList()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Request failed.')
    } finally {
      setRevisionBusy(false)
    }
  }

  async function onUploadStudentFile(file: File | null) {
    if (!file || mode !== 'student') return
    if (
      resubmissionWorkflowEnabled &&
      mine &&
      mine.attachmentFileId &&
      !mine.resubmissionRequested
    ) {
      window.alert(
        'Resubmission is not open. Your instructor must request a revision before you can upload a new file.',
      )
      return
    }
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
      const { embedUrl, summary } = await fetchSubmissionOriginalityEmbed(courseCode, itemId, current.id)
      if (embedUrl) {
        let url = embedUrl
        if (!/^https?:\/\//i.test(url)) {
          url = `${window.location.origin}${url.startsWith('/') ? '' : '/'}${url}`
        }
        setOriginalityEmbedUrl(url)
        setOriginalitySummary(summary)
        setOriginalityViewSummaryOnly(false)
        setOriginalityViewerOpen(true)
        return
      }
      if (summary) {
        setOriginalityEmbedUrl(null)
        setOriginalitySummary(summary)
        setOriginalityViewSummaryOnly(true)
        setOriginalityViewerOpen(true)
        return
      }
      window.alert('No originality report is available yet for this submission.')
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
            {resubmissionWorkflowEnabled && current && current.submittedBy && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setRevisionFormOpen((o) => !o)
                  if (!revDueLocal && !revFeedback) {
                    setRevDueLocal('')
                  }
                }}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800/80"
              >
                Request revision
              </button>
            )}
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

      {revisionFormOpen && resubmissionWorkflowEnabled && mode === 'staff' && current?.id && (
        <div className="rounded-lg border border-slate-200 bg-slate-50/90 p-4 dark:border-neutral-600 dark:bg-neutral-900/60">
          <p className="text-sm font-medium text-slate-900 dark:text-neutral-100">
            Request a revision: {assignmentTitle}
          </p>
          <p className="mt-1 text-xs text-slate-600 dark:text-neutral-400">
            The student can resubmit a new file while a revision is open. Optional: set a resubmission
            deadline.
          </p>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="text-sm text-slate-700 dark:text-neutral-200">
              <span className="mb-1 block text-xs font-semibold text-slate-500 dark:text-neutral-400">
                Resubmit by
              </span>
              <input
                type="datetime-local"
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-neutral-600 dark:bg-neutral-950"
                value={revDueLocal}
                onChange={(e) => setRevDueLocal(e.target.value)}
                disabled={revisionBusy}
              />
            </label>
            <div className="min-w-0 flex-1">
              <span className="mb-1 block text-xs font-semibold text-slate-500 dark:text-neutral-400">
                Feedback
              </span>
              <textarea
                className="min-h-20 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-600 dark:bg-neutral-950"
                value={revFeedback}
                onChange={(e) => setRevFeedback(e.target.value)}
                rows={3}
                disabled={revisionBusy}
                placeholder="What should the student change before resubmitting?"
              />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
              disabled={revisionBusy}
              onClick={() => void onRequestRevision()}
            >
              {revisionBusy ? 'Saving…' : 'Send revision request'}
            </button>
            <button
              type="button"
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-600 dark:bg-neutral-900"
              onClick={() => {
                setRevisionFormOpen(false)
                setRevDueLocal('')
                setRevFeedback('')
              }}
              disabled={revisionBusy}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {resubmissionWorkflowEnabled && mode === 'staff' && submissionVersions.length > 0 && current?.id ? (
        <div
          className="flex flex-wrap gap-1 border-b border-slate-200 pb-1 dark:border-neutral-600"
          role="tablist"
          aria-label="Submission version"
        >
          {submissionVersions.map((v) => {
            const active = (viewVersionNumber ?? submissionVersions[submissionVersions.length - 1]?.versionNumber) === v.versionNumber
            return (
              <button
                key={v.versionNumber}
                type="button"
                role="tab"
                aria-selected={active}
                className={`rounded-t-md px-2.5 py-1.5 text-xs font-semibold ${
                  active
                    ? 'bg-slate-100 text-slate-900 dark:bg-neutral-800 dark:text-neutral-50'
                    : 'text-slate-600 hover:bg-slate-50 dark:text-neutral-400 dark:hover:bg-neutral-800/60'
                }`}
                onClick={() => setViewVersionNumber(v.versionNumber)}
                tabIndex={0}
              >
                Version {v.versionNumber}
              </button>
            )
          })}
        </div>
      ) : null}

      {originalityViewerOpen ? (
        <OriginalityReportViewer
          open={originalityViewerOpen}
          onClose={() => {
            setOriginalityViewerOpen(false)
            setOriginalityEmbedUrl(null)
            setOriginalitySummary(null)
            setOriginalityViewSummaryOnly(false)
          }}
          embedUrl={originalityEmbedUrl ?? ''}
          storedSummary={originalitySummary}
          viewStoredSummaryOnly={originalityViewSummaryOnly}
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

      {resubmissionWorkflowEnabled && mode === 'student' && mine?.resubmissionRequested ? (
        <div
          className="rounded-lg border border-amber-200 bg-amber-50/95 px-3 py-2 text-sm text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100"
          role="status"
        >
          <p className="font-semibold">Revision requested for “{assignmentTitle}”</p>
          {mine.revisionFeedback ? (
            <p className="mt-1 text-amber-950/90 dark:text-amber-100/90">{mine.revisionFeedback}</p>
          ) : null}
          {mine.revisionDueAt ? (
            <p className="mt-2" role="timer" aria-live="off">
              <span className="text-xs font-medium uppercase text-amber-900/80 dark:text-amber-200/80">
                Resubmit by:{' '}
              </span>
              {new Date(mine.revisionDueAt).toLocaleString(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
              {Number.isFinite(new Date(mine.revisionDueAt).getTime() - deadlineNow) ? (
                <span className="ml-2 text-xs text-amber-900/70 dark:text-amber-200/80">
                  (
                  {new Date(mine.revisionDueAt).getTime() > deadlineNow
                    ? `${Math.max(0, Math.floor((new Date(mine.revisionDueAt).getTime() - deadlineNow) / 60000))} min left`
                    : 'deadline passed'}
                  )
                </span>
              ) : null}
            </p>
          ) : null}
        </div>
      ) : null}

      {showDocPanel && mode === 'student' && submissionAllowsFile ? (
        <div className="flex flex-wrap items-center gap-3">
          <label
            className={`text-sm font-medium ${mine?.resubmissionRequested || !mine?.attachmentFileId ? 'text-slate-700 dark:text-neutral-200' : 'text-slate-400 dark:text-neutral-500'}`}
          >
            <span className="mr-2">
              {mine?.resubmissionRequested
                ? 'Resubmit file'
                : resubmissionWorkflowEnabled && mine?.attachmentFileId
                  ? 'Replace file (locked — revision not requested)'
                  : 'Upload file'}
            </span>
            <input
              type="file"
              accept=".pdf,image/png,image/jpeg,image/webp"
              disabled={
                busy ||
                (Boolean(resubmissionWorkflowEnabled) &&
                  Boolean(mine?.attachmentFileId) &&
                  !mine?.resubmissionRequested)
              }
              className="text-sm"
              onChange={(e) => void onUploadStudentFile(e.target.files?.[0] ?? null)}
            />
          </label>
        </div>
      ) : null}

      {showDocPanel && panel === 'document' && displayMimeType === 'application/pdf' && current?.id ? (
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
            disabled={busy || !(current?.attachmentFileId || displayFilePath)}
            readOnly={readOnlyDocument}
          />

          <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
            <div className="min-w-0 flex-1">
              <AnnotationViewer
                filePath={displayFilePath ?? null}
                mimeType={displayMimeType ?? null}
                readOnly={readOnlyDocument}
                tool={tool}
                colour={colour}
                annotations={annotations}
                onHighlightComplete={readOnlyDocument ? undefined : onHighlightComplete}
                onDrawComplete={readOnlyDocument ? undefined : onDrawComplete}
                onPinComplete={readOnlyDocument ? undefined : onPinComplete}
                onTextBoxComplete={readOnlyDocument ? undefined : onTextBoxComplete}
              />
            </div>
            <AnnotationCommentPanel
              annotations={annotations}
              selectedId={selectedId}
              onSelect={setSelectedId}
              readOnly={readOnlyDocument}
              onDelete={readOnlyDocument ? undefined : onDeleteAnnotation}
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
