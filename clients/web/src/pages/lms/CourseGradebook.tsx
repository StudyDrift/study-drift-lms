import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { usePermissions } from '../../context/usePermissions'
import {
  courseGradebookViewPermission,
  courseItemCreatePermission,
  fetchCourseGradebookGrid,
  fetchCourseGradingSettings,
  putCourseGradebookGrades,
  type CourseGradebookGridColumn,
  type CourseGradebookGridStudent,
} from '../../lib/coursesApi'
import {
  GradebookGrid,
  type GradebookColumn,
  type GradebookStudent,
} from './gradebook/GradebookGrid'
import type { AssignmentGroupWeight } from './gradebook/computeCourseFinalPercent'
import { LmsPage } from './LmsPage'

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
): Record<string, Record<string, string>> {
  const out = buildEmptyGrades(students, columns)
  if (!apiGrades) return out
  for (const s of students) {
    const row = apiGrades[s.id]
    if (!row) continue
    for (const c of columns) {
      const v = row[c.id]
      if (v != null && String(v).trim() !== '') {
        out[s.id][c.id] = String(v).trim()
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

export default function CourseGradebook() {
  const { courseCode } = useParams<{ courseCode: string }>()
  const { allows, loading } = usePermissions()
  const [students, setStudents] = useState<CourseGradebookGridStudent[]>([])
  const [columns, setColumns] = useState<CourseGradebookGridColumn[]>([])
  const [assignmentGroups, setAssignmentGroups] = useState<AssignmentGroupWeight[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')
  const [savedGrades, setSavedGrades] = useState<Record<string, Record<string, string>> | null>(null)
  const [gradesDirty, setGradesDirty] = useState(false)
  const [gridNonce, setGridNonce] = useState(0)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const gradesRef = useRef<Record<string, Record<string, string>>>({})

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
      })),
    [columns],
  )

  const canEditGrades = !loading && courseCode != null && allows(courseItemCreatePermission(courseCode))

  const initialGrades = useMemo(() => {
    if (savedGrades == null) return buildEmptyGrades(gridStudents, gridColumns)
    return savedGrades
  }, [savedGrades, gridStudents, gridColumns])

  const handleGradesChange = useCallback(
    (g: Record<string, Record<string, string>>) => {
      gradesRef.current = g
      if (savedGrades == null) return
      setGradesDirty(!gradeMapsEqual(g, savedGrades, gridStudents, gridColumns))
    },
    [savedGrades, gridStudents, gridColumns],
  )

  const loadGrid = useCallback(async () => {
    if (!courseCode) return
    setLoadState('loading')
    setLoadError(null)
    try {
      const data = await fetchCourseGradebookGrid(courseCode)
      setStudents(data.students)
      setColumns(data.columns)
      const merged = mergeGradesFromApi(
        data.students.map((s) => ({ id: s.userId, name: s.displayName })),
        data.columns.map((c) => ({
          id: c.id,
          title: c.title,
          maxPoints: c.maxPoints,
          assignmentGroupId: c.assignmentGroupId ?? null,
        })),
        data.grades,
      )
      setSavedGrades(merged)
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
    } catch (e: unknown) {
      setStudents([])
      setColumns([])
      setAssignmentGroups([])
      setSavedGrades(null)
      setGradesDirty(false)
      setLoadState('error')
      setLoadError(e instanceof Error ? e.message : 'Could not load gradebook.')
    }
  }, [courseCode])

  const handleDiscard = useCallback(() => {
    setSaveError(null)
    setGridNonce((n) => n + 1)
    setGradesDirty(false)
  }, [])

  const handleSave = useCallback(async () => {
    if (!courseCode || savedGrades == null) return
    setSaving(true)
    setSaveError(null)
    try {
      const payload = buildFullGradesPayload(gradesRef.current, gridStudents, gridColumns)
      await putCourseGradebookGrades(courseCode, payload)
      await loadGrid()
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : 'Could not save grades.')
    } finally {
      setSaving(false)
    }
  }, [courseCode, savedGrades, gridStudents, gridColumns, loadGrid])

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
    return null
  }

  if (!allows(courseGradebookViewPermission(courseCode))) {
    return <Navigate to={`/courses/${encodeURIComponent(courseCode)}`} replace />
  }

  return (
    <LmsPage
      title="Gradebook"
      description="Spreadsheet-style grades for enrolled students and each course assignment or quiz. Use the arrows, Tab, Enter, and double-click to edit cells; Save writes your changes to the server."
    >
      {loadState === 'loading' && (
        <p className="mt-6 text-sm text-slate-600 dark:text-neutral-400">Loading gradebook…</p>
      )}
      {loadState === 'error' && loadError && (
        <p className="mt-6 text-sm text-red-600 dark:text-red-400" role="alert">
          {loadError}
        </p>
      )}
      {loadState === 'ok' && savedGrades != null && (
        <>
          {canEditGrades && gridStudents.length > 0 && gridColumns.length > 0 && (
            <div className="mt-6 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
              <div className="min-w-0 flex-1 text-sm text-slate-600 dark:text-neutral-400">
                {gradesDirty ? (
                  <span>You have unsaved grade changes.</span>
                ) : (
                  <span>All changes saved.</span>
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
          <GradebookGrid
            key={`${courseCode}:${gridNonce}:${gridStudents.map((s) => s.id).join(',')}:${gridColumns.map((c) => c.id).join(',')}:${assignmentGroups.map((g) => g.id).join(',')}`}
            columns={gridColumns}
            students={gridStudents}
            initialGrades={initialGrades}
            assignmentGroups={assignmentGroups}
            readOnly={!canEditGrades}
            onGradesChange={handleGradesChange}
            footerNote={
              gridStudents.length > 0 && gridColumns.length > 0
                ? canEditGrades
                  ? 'Final is the weighted course percentage from entered scores (or straight points if weights are unset). Use Save to write grades to the server.'
                  : 'You can view grades but only editors with permission to manage course items can change scores. Final uses weights from grading settings when set.'
                : undefined
            }
          />
        </>
      )}
    </LmsPage>
  )
}
