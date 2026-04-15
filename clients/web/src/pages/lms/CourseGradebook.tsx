import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { usePermissions } from '../../context/usePermissions'
import {
  courseGradebookViewPermission,
  fetchCourseGradebookGrid,
  fetchCourseGradingSettings,
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

export default function CourseGradebook() {
  const { courseCode } = useParams<{ courseCode: string }>()
  const { allows, loading } = usePermissions()
  const [students, setStudents] = useState<CourseGradebookGridStudent[]>([])
  const [columns, setColumns] = useState<CourseGradebookGridColumn[]>([])
  const [assignmentGroups, setAssignmentGroups] = useState<AssignmentGroupWeight[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')

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
  const initialGrades = useMemo(
    () => buildEmptyGrades(gridStudents, gridColumns),
    [gridStudents, gridColumns],
  )

  const loadGrid = useCallback(async () => {
    if (!courseCode) return
    setLoadState('loading')
    setLoadError(null)
    try {
      const data = await fetchCourseGradebookGrid(courseCode)
      setStudents(data.students)
      setColumns(data.columns)
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
      setLoadState('error')
      setLoadError(e instanceof Error ? e.message : 'Could not load gradebook.')
    }
  }, [courseCode])

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
      description="Spreadsheet-style grades for enrolled students and each course assignment or quiz. Use the arrows, Tab, Enter, and double-click to edit cells."
    >
      {loadState === 'loading' && (
        <p className="mt-6 text-sm text-slate-600 dark:text-neutral-400">Loading gradebook…</p>
      )}
      {loadState === 'error' && loadError && (
        <p className="mt-6 text-sm text-red-600 dark:text-red-400" role="alert">
          {loadError}
        </p>
      )}
      {loadState === 'ok' && (
        <GradebookGrid
          key={`${courseCode}:${gridStudents.map((s) => s.id).join(',')}:${gridColumns.map((c) => c.id).join(',')}:${assignmentGroups.map((g) => g.id).join(',')}`}
          columns={gridColumns}
          students={gridStudents}
          initialGrades={initialGrades}
          assignmentGroups={assignmentGroups}
          footerNote={
            gridStudents.length > 0 && gridColumns.length > 0
              ? 'Scores you type here are not saved yet. Final is the weighted course percentage from those scores (or straight points if weights are unset).'
              : undefined
          }
        />
      )}
    </LmsPage>
  )
}
