import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import {
  fetchCourseMyGrades,
  type CourseGradebookGridColumn,
  viewerShouldShowMyGradesNav,
} from '../../lib/coursesApi'
import { useCourseViewAs } from '../../lib/courseViewAs'
import { useViewerEnrollmentRoles } from '../../lib/useViewerEnrollmentRoles'
import {
  computeCourseFinalPercent,
  formatFinalPercent,
  type AssignmentGroupWeight,
  type GradebookColumnForFinal,
} from './gradebook/computeCourseFinalPercent'
import { LmsPage } from './LmsPage'

function parseEarned(raw: string | undefined): number {
  const t = (raw ?? '').trim()
  if (!t) return 0
  const n = Number.parseFloat(t.replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

function formatRowPercent(earned: number, max: number | null): string {
  if (max == null || max <= 0) return '—'
  return `${Math.round((earned / max) * 1000) / 10}%`
}

export default function CourseMyGrades() {
  const { courseCode } = useParams<{ courseCode: string }>()
  const viewerEnrollmentRoles = useViewerEnrollmentRoles(courseCode)
  const courseViewPreview = useCourseViewAs(courseCode)
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [columns, setColumns] = useState<CourseGradebookGridColumn[]>([])
  const [grades, setGrades] = useState<Record<string, string>>({})
  const [assignmentGroups, setAssignmentGroups] = useState<AssignmentGroupWeight[]>([])

  const canView = useMemo(() => {
    if (!courseCode) return false
    if (viewerEnrollmentRoles === null) return false
    return viewerShouldShowMyGradesNav(viewerEnrollmentRoles, courseViewPreview)
  }, [courseCode, viewerEnrollmentRoles, courseViewPreview])

  const load = useCallback(async () => {
    if (!courseCode) return
    setLoadState('loading')
    setLoadError(null)
    try {
      const data = await fetchCourseMyGrades(courseCode)
      setColumns(data.columns)
      setGrades(data.grades)
      setAssignmentGroups(
        data.assignmentGroups.map((g) => ({ id: g.id, weightPercent: g.weightPercent })),
      )
      setLoadState('ok')
    } catch (e: unknown) {
      setLoadState('error')
      setLoadError(e instanceof Error ? e.message : 'Could not load grades.')
    }
  }, [courseCode])

  useEffect(() => {
    if (!courseCode || !canView) return
    let cancelled = false
    void load().then(() => {
      if (cancelled) return
    })
    return () => {
      cancelled = true
    }
  }, [courseCode, canView, load])

  const finalCols: GradebookColumnForFinal[] = useMemo(
    () =>
      columns.map((c) => ({
        id: c.id,
        maxPoints: c.maxPoints,
        assignmentGroupId: c.assignmentGroupId ?? null,
      })),
    [columns],
  )

  const finalPct = useMemo(
    () => computeCourseFinalPercent(finalCols, grades, assignmentGroups),
    [finalCols, grades, assignmentGroups],
  )

  const base = `/courses/${encodeURIComponent(courseCode ?? '')}`

  if (!courseCode) {
    return <Navigate to="/courses" replace />
  }

  if (viewerEnrollmentRoles === null) {
    return null
  }

  if (!canView) {
    return <Navigate to={`/courses/${encodeURIComponent(courseCode)}`} replace />
  }

  return (
    <LmsPage
      title="My grades"
      description="Your earned points and course average from the gradebook. Contact your instructor if something looks wrong."
    >
      {loadState === 'loading' && (
        <p className="mt-6 text-sm text-slate-600 dark:text-neutral-400">Loading grades…</p>
      )}
      {loadState === 'error' && loadError && (
        <p className="mt-6 text-sm text-red-600 dark:text-red-400" role="alert">
          {loadError}
        </p>
      )}
      {loadState === 'ok' && (
        <>
          <div className="mt-6 rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
            <p className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-neutral-100">
              Course grade: {formatFinalPercent(finalPct)}
            </p>
            <p className="mt-1 text-sm text-slate-600 dark:text-neutral-400">
              Weighted from assignment groups when your instructor has configured weights; otherwise
              by points earned vs points possible.
            </p>
          </div>
          {columns.length === 0 ? (
            <p className="mt-6 text-sm text-slate-600 dark:text-neutral-400">
              No graded assignments or quizzes are listed in this course yet.
            </p>
          ) : (
            <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
              <table className="min-w-full divide-y divide-slate-200 text-left text-sm dark:divide-neutral-700">
                <thead>
                  <tr className="bg-slate-50 dark:bg-neutral-800/80">
                    <th className="px-4 py-3 font-semibold text-slate-900 dark:text-neutral-100">
                      Assignment
                    </th>
                    <th className="px-4 py-3 font-semibold text-slate-900 dark:text-neutral-100">
                      Type
                    </th>
                    <th className="px-4 py-3 font-semibold text-slate-900 dark:text-neutral-100">
                      Earned
                    </th>
                    <th className="px-4 py-3 font-semibold text-slate-900 dark:text-neutral-100">
                      Possible
                    </th>
                    <th className="px-4 py-3 font-semibold text-slate-900 dark:text-neutral-100">
                      Item %
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-neutral-700">
                  {columns.map((col) => {
                    const earned = grades[col.id]
                    const earnedNum = parseEarned(earned)
                    const max = col.maxPoints
                    const href =
                      col.kind === 'quiz'
                        ? `${base}/modules/quiz/${encodeURIComponent(col.id)}`
                        : `${base}/modules/assignment/${encodeURIComponent(col.id)}`
                    return (
                      <tr key={col.id} className="hover:bg-slate-50/80 dark:hover:bg-neutral-800/80">
                        <td className="px-4 py-3 font-medium text-slate-900 dark:text-neutral-100">
                          <Link
                            to={href}
                            className="text-indigo-600 hover:underline dark:text-indigo-400"
                          >
                            {col.title}
                          </Link>
                        </td>
                        <td className="px-4 py-3 capitalize text-slate-600 dark:text-neutral-400">
                          {col.kind === 'quiz' ? 'Quiz' : 'Assignment'}
                        </td>
                        <td className="px-4 py-3 text-slate-800 dark:text-neutral-200">
                          {(earned ?? '').trim() ? earned : '—'}
                        </td>
                        <td className="px-4 py-3 text-slate-800 dark:text-neutral-200">
                          {max != null && max > 0 ? String(max) : '—'}
                        </td>
                        <td className="px-4 py-3 text-slate-800 dark:text-neutral-200">
                          {formatRowPercent(earnedNum, max)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </LmsPage>
  )
}
