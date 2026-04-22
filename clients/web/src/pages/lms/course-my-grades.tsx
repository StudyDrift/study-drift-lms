import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import {
  fetchCourseMyGrades,
  fetchMyGradeItemHistory,
  type AssignmentGroup,
  type CourseGradebookGridColumn,
  type GradeHistoryEvent,
  viewerShouldShowMyGradesNav,
} from '../../lib/courses-api'
import { useCourseViewAs } from '../../lib/course-view-as'
import { useViewerEnrollmentRoles } from '../../lib/use-viewer-enrollment-roles'
import {
  computeCourseFinalPercent,
  formatFinalPercent,
  type AssignmentGroupWeight,
  type GradebookColumnForFinal,
} from './gradebook/compute-course-final-percent'
import { GradeHistoryPanel } from '../../components/grading/grade-history-panel'
import { LmsPage } from './lms-page'

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
  const [displayGrades, setDisplayGrades] = useState<Record<string, string>>({})
  const [assignmentGroups, setAssignmentGroups] = useState<AssignmentGroup[]>([])
  const [heldGradeItemIds, setHeldGradeItemIds] = useState<string[]>([])
  const [droppedGrades, setDroppedGrades] = useState<Record<string, boolean>>({})
  const [historyItem, setHistoryItem] = useState<{
    id: string
    title: string
  } | null>(null)
  const [historyLoad, setHistoryLoad] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')
  const [historyErr, setHistoryErr] = useState<string | null>(null)
  const [historyEvents, setHistoryEvents] = useState<GradeHistoryEvent[] | null>(null)

  const canView = useMemo(() => {
    if (!courseCode) return false
    if (viewerEnrollmentRoles === null && courseViewPreview !== 'student') return false
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
      setDisplayGrades(data.displayGrades ?? {})
      setAssignmentGroups(data.assignmentGroups)
      setHeldGradeItemIds(data.heldGradeItemIds ?? [])
      setDroppedGrades(data.droppedGrades ?? {})
      setLoadState('ok')
    } catch (e: unknown) {
      setLoadState('error')
      setLoadError(e instanceof Error ? e.message : 'Could not load grades.')
    }
  }, [courseCode])

  useEffect(() => {
    if (!courseCode || !canView) return
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      void load()
    })
    return () => {
      cancelled = true
    }
  }, [courseCode, canView, load])

  useEffect(() => {
    if (!courseCode || !historyItem) return
    let cancelled = false
    void (async () => {
      try {
        const d = await fetchMyGradeItemHistory(courseCode, historyItem.id)
        if (cancelled) return
        setHistoryEvents(d.events)
        setHistoryLoad('ok')
      } catch (e: unknown) {
        if (cancelled) return
        setHistoryErr(e instanceof Error ? e.message : 'Could not load history')
        setHistoryLoad('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [courseCode, historyItem])

  const openGradeHistory = useCallback((id: string, title: string) => {
    setHistoryErr(null)
    setHistoryEvents(null)
    setHistoryLoad('loading')
    setHistoryItem({ id, title })
  }, [])

  const closeGradeHistory = useCallback(() => {
    setHistoryItem(null)
    setHistoryLoad('idle')
    setHistoryErr(null)
    setHistoryEvents(null)
  }, [])

  const heldSet = useMemo(() => new Set(heldGradeItemIds), [heldGradeItemIds])

  const finalCols: GradebookColumnForFinal[] = useMemo(
    () =>
      columns
        .filter((c) => !heldSet.has(c.id))
        .map((c) => ({
          id: c.id,
          maxPoints: c.maxPoints,
          assignmentGroupId: c.assignmentGroupId ?? null,
          neverDrop: c.neverDrop === true,
          replaceWithFinal: c.replaceWithFinal === true,
        })),
    [columns, heldSet],
  )

  const groupsForFinal: AssignmentGroupWeight[] = useMemo(
    () =>
      assignmentGroups.map((g) => ({
        id: g.id,
        weightPercent: g.weightPercent,
        dropLowest: g.dropLowest,
        dropHighest: g.dropHighest,
        replaceLowestWithFinal: g.replaceLowestWithFinal,
      })),
    [assignmentGroups],
  )

  const finalPct = useMemo(
    () => computeCourseFinalPercent(finalCols, grades, groupsForFinal),
    [finalCols, grades, groupsForFinal],
  )

  const base = `/courses/${encodeURIComponent(courseCode ?? '')}`

  if (!courseCode) {
    return <Navigate to="/courses" replace />
  }

  if (viewerEnrollmentRoles === null && courseViewPreview !== 'student') {
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
                    <th className="px-4 py-3 font-semibold text-slate-900 dark:text-neutral-100">Policy</th>
                    <th className="px-4 py-3 font-semibold text-slate-900 dark:text-neutral-100">History</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-neutral-700">
                  {columns.map((col) => {
                    const held = heldSet.has(col.id)
                    const dropped = !held && droppedGrades[col.id] === true
                    const earned = held ? undefined : grades[col.id]
                    const display = held ? undefined : displayGrades[col.id]
                    const earnedNum = held ? 0 : parseEarned(earned)
                    const max = col.maxPoints
                    const href =
                      col.kind === 'quiz'
                        ? `${base}/modules/quiz/${encodeURIComponent(col.id)}`
                        : `${base}/modules/assignment/${encodeURIComponent(col.id)}`
                    return (
                      <tr
                        key={col.id}
                        className={`hover:bg-slate-50/80 dark:hover:bg-neutral-800/80 ${dropped ? 'text-slate-500 dark:text-neutral-500' : ''}`}
                      >
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
                        <td
                          className={`px-4 py-3 text-slate-800 dark:text-neutral-200 ${dropped ? 'line-through decoration-slate-400' : ''}`}
                          aria-label={
                            dropped
                              ? 'Score shown but dropped from course total by group policy'
                              : undefined
                          }
                        >
                          {held ? (
                            <span className="text-amber-800 dark:text-amber-200/90" title="Grades not yet released">
                              Grades pending
                            </span>
                          ) : (display ?? '').trim() ? (
                            display
                          ) : (earned ?? '').trim() ? (
                            earned
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-800 dark:text-neutral-200">
                          {max != null && max > 0 ? String(max) : '—'}
                        </td>
                        <td className="px-4 py-3 text-slate-800 dark:text-neutral-200">
                          {formatRowPercent(earnedNum, max)}
                        </td>
                        <td className="px-4 py-3 text-slate-600 dark:text-neutral-400">
                          {dropped ? (
                            <span
                              className="inline-flex rounded-md border border-amber-200/80 bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/50 dark:text-amber-200"
                              title="This score is excluded from your course total by the group’s drop rules."
                            >
                              Dropped
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            className="text-sm text-indigo-600 hover:underline dark:text-indigo-400"
                            onClick={() => openGradeHistory(col.id, col.title)}
                          >
                            View
                          </button>
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
      {historyItem && courseCode && (
        <div
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-4 sm:items-center"
          role="presentation"
        >
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            aria-label="Close"
            onClick={() => closeGradeHistory()}
          />
          <div
            role="dialog"
            aria-modal="true"
            className="relative z-[1] w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl dark:border-neutral-700 dark:bg-neutral-900"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="absolute right-3 top-3 rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-neutral-800"
              onClick={() => closeGradeHistory()}
            >
              <span className="sr-only">Close</span>✕
            </button>
            <GradeHistoryPanel
              title={historyItem.title}
              events={historyEvents}
              loading={historyLoad === 'loading'}
              error={historyErr}
            />
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-800 hover:bg-slate-50 dark:border-neutral-600 dark:bg-neutral-800"
                onClick={() => closeGradeHistory()}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </LmsPage>
  )
}
