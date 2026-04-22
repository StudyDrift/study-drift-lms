import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useParams, useSearchParams } from 'react-router-dom'
import { usePermissions } from '../../context/use-permissions'
import {
  courseGradebookViewPermission,
  courseItemCreatePermission,
  fetchCourseGradebookGrid,
  fetchCourseGradingSettings,
  putCourseGradebookGrades,
  type CourseGradebookGridColumn,
  type CourseGradebookGridStudent,
  type RubricDefinition,
} from '../../lib/courses-api'
import {
  GradebookGrid,
  type GradebookColumn,
  type GradebookStudent,
} from './gradebook/gradebook-grid'
import type { AssignmentGroupWeight } from './gradebook/compute-course-final-percent'
import { GradebookLoadingSkeleton } from '../../components/ui/lms-content-skeletons'
import { formatAbsolute, formatAbsoluteShort } from '../../lib/format-datetime'
import { toastMutationError, toastSaveOk } from '../../lib/lms-toast'
import { TabPresenceHint } from '../../components/presence/tab-presence-hint'
import { FeatureHelpTrigger } from '../../components/feature-help/feature-help-trigger'
import { LmsPage } from './lms-page'

function buildEmptyGrades(students: GradebookStudent[], columns: GradebookColumn[]): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {}
  for (const s of students) {
    const row: Record<string, string> = {}
    for (const c of columns) {
      row[c.id] = ''
    }
    out[s.id] = row
  }
  return out
}

function mergeGradesFromApi(
  students: GradebookStudent[],
  columns: GradebookColumn[],
  apiGrades: Record<string, Record<string, string>> | undefined,
  apiDisplay?: Record<string, Record<string, string>> | undefined,
): Record<string, Record<string, string>> {
  const out = buildEmptyGrades(students, columns)
  for (const s of students) {
    const row = apiGrades?.[s.id]
    const drow = apiDisplay?.[s.id]
    if (!row && !drow) continue
    for (const c of columns) {
      const disp = drow?.[c.id]
      const raw = row?.[c.id]
      const v =
        disp != null && String(disp).trim() !== ''
          ? String(disp).trim()
          : raw != null && String(raw).trim() !== ''
            ? String(raw).trim()
            : ''
      if (v) out[s.id][c.id] = v
    }
  }
  return out
}

function mergeRubricScoresFromApi(
  api: Record<string, Record<string, Record<string, string>>> | undefined,
): Record<string, Record<string, Record<string, number>>> {
  const out: Record<string, Record<string, Record<string, number>>> = {}
  if (!api) return out
  for (const [sid, row] of Object.entries(api)) {
    for (const [itemId, critMap] of Object.entries(row)) {
      for (const [critId, ptsStr] of Object.entries(critMap)) {
        const n = Number.parseFloat(String(ptsStr).replace(/,/g, ''))
        if (!Number.isFinite(n)) continue
        out[sid] ??= {}
        out[sid][itemId] ??= {}
        out[sid][itemId][critId] = n
      }
    }
  }
  return out
}

function gradeMapsEqual(
  a: Record<string, Record<string, string>>,
  b: Record<string, Record<string, string>>,
  students: GradebookStudent[],
  columns: GradebookColumn[],
): boolean {
  for (const s of students) {
    for (const c of columns) {
      const va = (a[s.id]?.[c.id] ?? '').trim()
      const vb = (b[s.id]?.[c.id] ?? '').trim()
      if (va !== vb) return false
    }
  }
  return true
}

function rubricScoreMapsEqual(
  a: Record<string, Record<string, Record<string, number>>>,
  b: Record<string, Record<string, Record<string, number>>>,
  students: GradebookStudent[],
  columns: GradebookColumn[],
): boolean {
  for (const s of students) {
    for (const c of columns) {
      if (!c.rubric) continue
      const ja = JSON.stringify(a[s.id]?.[c.id] ?? {})
      const jb = JSON.stringify(b[s.id]?.[c.id] ?? {})
      if (ja !== jb) return false
    }
  }
  return true
}

function buildFullGradesPayload(
  grades: Record<string, Record<string, string>>,
  students: GradebookStudent[],
  columns: GradebookColumn[],
): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {}
  for (const s of students) {
    const row: Record<string, string> = {}
    for (const c of columns) {
      row[c.id] = (grades[s.id]?.[c.id] ?? '').trim()
    }
    out[s.id] = row
  }
  return out
}

function buildFullRubricScoresPayload(
  rubricScores: Record<string, Record<string, Record<string, number>>>,
  students: GradebookStudent[],
  columns: GradebookColumn[],
): Record<string, Record<string, Record<string, number>>> {
  const out: Record<string, Record<string, Record<string, number>>> = {}
  for (const s of students) {
    const row: Record<string, Record<string, number>> = {}
    for (const c of columns) {
      if (!c.rubric) continue
      const cell = rubricScores[s.id]?.[c.id]
      if (cell && Object.keys(cell).length > 0) {
        row[c.id] = { ...cell }
      }
    }
    if (Object.keys(row).length > 0) {
      out[s.id] = row
    }
  }
  return out
}

function formatPointsCell(n: number): string {
  if (!Number.isFinite(n) || n < 0) return ''
  if (Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n))
  let s = n.toFixed(4)
  while (s.includes('.') && (s.endsWith('0') || s.endsWith('.'))) {
    s = s.slice(0, -1)
  }
  return s
}

type RubricModalState = {
  studentId: string
  studentName: string
  columnId: string
  columnTitle: string
  rubric: RubricDefinition
}

function RubricGradeForm({
  state,
  initialScores,
  onClose,
  onSave,
}: {
  state: RubricModalState
  initialScores: Record<string, number>
  onClose: () => void
  onSave: (scores: Record<string, number>) => void
}) {
  const [local, setLocal] = useState<Record<string, number>>(() => ({ ...initialScores }))

  const total = state.rubric.criteria.reduce((sum, c) => sum + (local[c.id] ?? 0), 0)

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal
      aria-labelledby="rubric-grade-title"
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 shadow-xl dark:border-neutral-600 dark:bg-neutral-900">
        <h2 id="rubric-grade-title" className="text-lg font-semibold text-slate-950 dark:text-neutral-100">
          Rubric: {state.columnTitle}
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">{state.studentName}</p>
        <div className="mt-4 space-y-4">
          {state.rubric.criteria.map((c) => (
            <div key={c.id} className="rounded-lg border border-slate-100 p-3 dark:border-neutral-700">
              <p className="text-sm font-medium text-slate-900 dark:text-neutral-100">{c.title}</p>
              {c.description ? (
                <p className="mt-1 text-xs text-slate-500 dark:text-neutral-400">{c.description}</p>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-2">
                {c.levels.map((lvl, i) => (
                  <button
                    key={`${c.id}-${i}`}
                    type="button"
                    onClick={() => setLocal((prev) => ({ ...prev, [c.id]: lvl.points }))}
                    className={`max-w-full rounded-md border px-2.5 py-1.5 text-left text-xs font-medium transition ${
                      local[c.id] === lvl.points
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-950 dark:border-indigo-400 dark:bg-indigo-950/60 dark:text-indigo-100'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700'
                    }`}
                  >
                    <span className="block">
                      {lvl.label} ({formatPointsCell(lvl.points)})
                    </span>
                    {lvl.description ? (
                      <span className="mt-0.5 block text-[10px] font-normal leading-snug text-slate-500 dark:text-neutral-400">
                        {lvl.description}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-sm text-slate-600 dark:text-neutral-300">
          Total: <span className="font-semibold tabular-nums">{formatPointsCell(total)}</span>
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 dark:border-neutral-600 dark:text-neutral-100 dark:hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={
              !state.rubric.criteria.every(
                (c) => local[c.id] !== undefined && Number.isFinite(local[c.id]),
              )
            }
            onClick={() => onSave(local)}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-indigo-500 dark:hover:bg-indigo-400"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}

function RubricGradeModal({
  open,
  state,
  initialScores,
  onClose,
  onSave,
}: {
  open: boolean
  state: RubricModalState | null
  initialScores: Record<string, number>
  onClose: () => void
  onSave: (scores: Record<string, number>) => void
}) {
  if (!open || !state) return null
  return (
    <RubricGradeForm
      key={`${state.studentId}-${state.columnId}-${JSON.stringify(initialScores)}`}
      state={state}
      initialScores={initialScores}
      onClose={onClose}
      onSave={onSave}
    />
  )
}

export default function CourseGradebook() {
  const { courseCode } = useParams<{ courseCode: string }>()
  const [searchParams] = useSearchParams()
  const highlightStudentId = searchParams.get('student')?.trim() || null
  const { allows, loading } = usePermissions()
  const [students, setStudents] = useState<CourseGradebookGridStudent[]>([])
  const [columns, setColumns] = useState<CourseGradebookGridColumn[]>([])
  const [assignmentGroups, setAssignmentGroups] = useState<AssignmentGroupWeight[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'ok' | 'error'>('loading')
  const [savedGrades, setSavedGrades] = useState<Record<string, Record<string, string>> | null>(null)
  const [savedRubricScores, setSavedRubricScores] = useState<
    Record<string, Record<string, Record<string, number>>>
  >({})
  const [optimisticGrades, setOptimisticGrades] = useState<Record<string, Record<string, string>> | null>(null)
  const [gradesDirty, setGradesDirty] = useState(false)
  const [gridNonce, setGridNonce] = useState(0)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)
  const [gradingScheme, setGradingScheme] = useState<{ type: string; scaleJson: unknown } | null>(null)
  const gradesRef = useRef<Record<string, Record<string, string>>>({})
  const rubricScoresRef = useRef<Record<string, Record<string, Record<string, number>>>>({})
  const [rubricModal, setRubricModal] = useState<RubricModalState | null>(null)

  const gridStudents: GradebookStudent[] = useMemo(
    () => students.map((s) => ({ id: s.userId, name: s.displayName })),
    [students],
  )
  const gridColumns: GradebookColumn[] = useMemo(
    () =>
      columns.map((c) => ({
        id: c.id,
        title: c.title,
        maxPoints: c.maxPoints,
        assignmentGroupId: c.assignmentGroupId ?? null,
        rubric: c.rubric ?? null,
        effectiveDisplayType: c.effectiveDisplayType ?? 'points',
      })),
    [columns],
  )

  const canEditGrades = !loading && courseCode != null && allows(courseItemCreatePermission(courseCode))

  const initialGrades = useMemo(() => {
    if (optimisticGrades != null) return optimisticGrades
    if (savedGrades != null) return savedGrades
    return buildEmptyGrades(gridStudents, gridColumns)
  }, [optimisticGrades, savedGrades, gridStudents, gridColumns])

  const recomputeDirty = useCallback(() => {
    if (savedGrades == null) return
    const g = gradesRef.current
    const r = rubricScoresRef.current
    const gradeD = !gradeMapsEqual(g, savedGrades, gridStudents, gridColumns)
    const rubricD = !rubricScoreMapsEqual(r, savedRubricScores, gridStudents, gridColumns)
    setGradesDirty(gradeD || rubricD)
  }, [savedGrades, savedRubricScores, gridStudents, gridColumns])

  const handleGradesChange = useCallback(
    (g: Record<string, Record<string, string>>) => {
      gradesRef.current = g
      recomputeDirty()
    },
    [recomputeDirty],
  )

  const loadGrid = useCallback(async () => {
    if (!courseCode) return
    setLoadState('loading')
    setLoadError(null)
    try {
      const data = await fetchCourseGradebookGrid(courseCode)
      setStudents(data.students)
      setColumns(data.columns)
      const gridSt = data.students.map((s) => ({ id: s.userId, name: s.displayName }))
      const gridCols: GradebookColumn[] = data.columns.map((c) => ({
        id: c.id,
        title: c.title,
        maxPoints: c.maxPoints,
        assignmentGroupId: c.assignmentGroupId ?? null,
        rubric: c.rubric ?? null,
        effectiveDisplayType: c.effectiveDisplayType ?? 'points',
      }))
      setGradingScheme(data.gradingScheme ?? null)
      const merged = mergeGradesFromApi(gridSt, gridCols, data.grades, data.displayGrades)
      const mergedRubric = mergeRubricScoresFromApi(data.rubricScores)
      setSavedGrades(merged)
      setSavedRubricScores(mergedRubric)
      gradesRef.current = structuredClone(merged)
      rubricScoresRef.current = structuredClone(mergedRubric)
      setOptimisticGrades(null)
      setGradesDirty(false)
      setGridNonce((n) => n + 1)
      try {
        const grading = await fetchCourseGradingSettings(courseCode)
        setAssignmentGroups(
          grading.assignmentGroups.map((g) => ({ id: g.id, weightPercent: g.weightPercent })),
        )
      } catch {
        setAssignmentGroups([])
      }
      setLoadState('ok')
      setLastSavedAt(new Date())
    } catch (e: unknown) {
      setStudents([])
      setColumns([])
      setGradingScheme(null)
      setAssignmentGroups([])
      setSavedGrades(null)
      setSavedRubricScores({})
      setOptimisticGrades(null)
      setGradesDirty(false)
      setLoadState('error')
      setLoadError(e instanceof Error ? e.message : 'Could not load gradebook.')
    }
  }, [courseCode])

  const handleDiscard = useCallback(() => {
    setSaveError(null)
    if (savedGrades != null) {
      gradesRef.current = structuredClone(savedGrades)
      rubricScoresRef.current = structuredClone(savedRubricScores)
    }
    setOptimisticGrades(null)
    setGradesDirty(false)
    setGridNonce((n) => n + 1)
  }, [savedGrades, savedRubricScores])

  const handleSave = useCallback(async () => {
    if (!courseCode || savedGrades == null) return
    setSaving(true)
    setSaveError(null)
    try {
      const gradePayload = buildFullGradesPayload(gradesRef.current, gridStudents, gridColumns)
      const rubricPayload = buildFullRubricScoresPayload(
        rubricScoresRef.current,
        gridStudents,
        gridColumns,
      )
      await putCourseGradebookGrades(courseCode, {
        grades: gradePayload,
        rubricScores: rubricPayload,
      })
      await loadGrid()
      toastSaveOk('Gradebook saved')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Could not save grades.'
      setSaveError(msg)
      toastMutationError(msg)
    } finally {
      setSaving(false)
    }
  }, [courseCode, savedGrades, gridStudents, gridColumns, loadGrid])

  const openRubricModal = useCallback((studentId: string, columnId: string) => {
    const col = columns.find((c) => c.id === columnId)
    const st = students.find((s) => s.userId === studentId)
    if (!col?.rubric || !st) return
    setRubricModal({
      studentId,
      studentName: st.displayName,
      columnId,
      columnTitle: col.title,
      rubric: col.rubric,
    })
  }, [columns, students])

  const modalInitialScores = useMemo(() => {
    if (!rubricModal) return {}
    return { ...(rubricScoresRef.current[rubricModal.studentId]?.[rubricModal.columnId] ?? {}) }
  }, [rubricModal])

  const handleRubricModalSave = useCallback(
    (scores: Record<string, number>) => {
      if (!rubricModal) return
      const { studentId, columnId, rubric } = rubricModal
      const total = rubric.criteria.reduce((s, c) => s + (scores[c.id] ?? 0), 0)
      const nextGrades = structuredClone(gradesRef.current)
      nextGrades[studentId] = { ...nextGrades[studentId], [columnId]: formatPointsCell(total) }
      gradesRef.current = nextGrades
      const rs = structuredClone(rubricScoresRef.current)
      rs[studentId] = { ...rs[studentId], [columnId]: scores }
      rubricScoresRef.current = rs
      setOptimisticGrades(nextGrades)
      setGridNonce((n) => n + 1)
      setRubricModal(null)
      recomputeDirty()
    },
    [rubricModal, recomputeDirty],
  )

  useEffect(() => {
    if (!courseCode || loading) return
    if (!allows(courseGradebookViewPermission(courseCode))) return
    let cancelled = false
    void loadGrid().then(() => {
      if (cancelled) return
    })
    return () => {
      cancelled = true
    }
  }, [allows, courseCode, loadGrid, loading])

  if (!courseCode) {
    return <Navigate to="/courses" replace />
  }

  if (loading) {
    return (
      <LmsPage
        title="Gradebook"
        description="Spreadsheet-style grades for enrolled students and each course assignment or quiz. Use the arrows, Tab, Enter, and double-click to edit cells; assignment rubrics open from the Rubric link. Save writes your changes to the server."
      >
        <GradebookLoadingSkeleton />
      </LmsPage>
    )
  }

  if (!allows(courseGradebookViewPermission(courseCode))) {
    return <Navigate to={`/courses/${encodeURIComponent(courseCode)}`} replace />
  }

  return (
    <LmsPage
      title="Gradebook"
      description="Spreadsheet-style grades for enrolled students and each course assignment or quiz. Use the arrows, Tab, Enter, and double-click to edit cells; assignment rubrics open from the Rubric link. Save writes your changes to the server."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <FeatureHelpTrigger topic="gradebook" />
        </div>
      }
    >
      {loadState === 'loading' && <GradebookLoadingSkeleton />}
      {loadState === 'error' && loadError && (
        <p className="mt-6 text-sm text-red-600 dark:text-red-400" role="alert">
          {loadError}
        </p>
      )}
      {loadState === 'ok' && savedGrades != null && (
        <>
          {canEditGrades && gridStudents.length > 0 && gridColumns.length > 0 && (
            <div
              className="lms-print-hide mt-6 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-neutral-700 dark:bg-neutral-900"
              aria-live="polite"
            >
              <div className="min-w-0 flex-1 text-sm text-slate-600 dark:text-neutral-400">
                {gradesDirty ? (
                  <span>
                    Unsaved grade changes — <span className="font-medium text-amber-800 dark:text-amber-200">Save</span>{' '}
                    writes them to the server. <span className="font-medium text-slate-800 dark:text-neutral-200">Discard</span>{' '}
                    restores the last saved copy (same as reloading the page).
                  </span>
                ) : (
                  <span>
                    <span className="inline-flex items-center gap-1.5 font-medium text-emerald-800 dark:text-emerald-200">
                      <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden />
                      All changes saved
                    </span>
                    {lastSavedAt ? (
                      <time
                        className="text-slate-500 dark:text-neutral-500"
                        dateTime={lastSavedAt.toISOString()}
                        title={formatAbsolute(lastSavedAt)}
                      >
                        {' '}
                        ({formatAbsoluteShort(lastSavedAt)})
                      </time>
                    ) : null}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!gradesDirty || saving}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700/80"
                  onClick={handleDiscard}
                >
                  Discard
                </button>
                <button
                  type="button"
                  disabled={!gradesDirty || saving}
                  className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-indigo-500 dark:hover:bg-indigo-400"
                  onClick={() => void handleSave()}
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          )}
          {saveError && (
            <p className="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">
              {saveError}
            </p>
          )}
          {courseCode ? (
            <div className="mt-2">
              <TabPresenceHint channelKey={courseCode} />
            </div>
          ) : null}
          <GradebookGrid
            key={`${courseCode}:${gridNonce}:${gridStudents.map((s) => s.id).join(',')}:${gridColumns.map((c) => c.id).join(',')}:${assignmentGroups.map((g) => g.id).join(',')}`}
            courseCode={courseCode}
            columns={gridColumns}
            students={gridStudents}
            initialGrades={initialGrades}
            assignmentGroups={assignmentGroups}
            readOnly={!canEditGrades}
            onGradesChange={handleGradesChange}
            onRubricClick={canEditGrades ? openRubricModal : undefined}
            highlightStudentId={highlightStudentId}
            gradingScheme={gradingScheme}
            footerNote={
              gridStudents.length > 0 && gridColumns.length > 0
                ? canEditGrades
                  ? 'Final is the weighted course percentage from entered scores (or straight points if weights are unset). Use Save to write grades to the server.'
                  : 'You can view grades but only editors with permission to manage course items can change scores. Final uses weights from grading settings when set.'
                : undefined
            }
          />
          <RubricGradeModal
            key={rubricModal ? `${rubricModal.studentId}-${rubricModal.columnId}` : 'closed'}
            open={rubricModal != null}
            state={rubricModal}
            initialScores={modalInitialScores}
            onClose={() => setRubricModal(null)}
            onSave={handleRubricModalSave}
          />
        </>
      )}
    </LmsPage>
  )
}
