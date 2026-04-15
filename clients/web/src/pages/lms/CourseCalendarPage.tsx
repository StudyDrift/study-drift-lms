import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { usePermissions } from '../../context/usePermissions'
import { fetchCourseStructure, type CourseStructureItem } from '../../lib/coursesApi'
import { permCourseItemsCreate } from '../../lib/rbacApi'
import { CourseCalendar, type CourseCalendarAssignment } from './CourseCalendar'
import { LmsPage } from './LmsPage'

export default function CourseCalendarPage() {
  const { courseCode } = useParams<{ courseCode: string }>()
  const { allows, loading: permLoading } = usePermissions()
  const [items, setItems] = useState<Awaited<ReturnType<typeof fetchCourseStructure>> | null>(null)
  const [error, setError] = useState<string | null>(null)

  const canRescheduleDueByDrag = Boolean(
    courseCode && !permLoading && allows(permCourseItemsCreate(courseCode)),
  )

  const load = useCallback(async () => {
    if (!courseCode) return
    setError(null)
    try {
      const data = await fetchCourseStructure(courseCode)
      setItems(data)
    } catch (e) {
      setItems(null)
      setError(e instanceof Error ? e.message : 'Could not load calendar.')
    }
  }, [courseCode])

  useEffect(() => {
    const id = window.setTimeout(() => {
      void load()
    }, 0)
    return () => window.clearTimeout(id)
  }, [load])

  const assignments: CourseCalendarAssignment[] = useMemo(() => {
    if (!items) return []
    const isDueCalendarItem = (
      i: CourseStructureItem,
    ): i is CourseStructureItem & {
      kind: 'content_page' | 'assignment' | 'quiz'
      dueAt: string
    } =>
      (i.kind === 'content_page' || i.kind === 'assignment' || i.kind === 'quiz') &&
      Boolean(i.dueAt)

    return items.filter(isDueCalendarItem).map((i) => ({
      id: i.id,
      title: i.title,
      dueAt: i.dueAt,
      kind: i.kind,
      pointsWorth: i.pointsWorth,
      pointsPossible: i.pointsPossible,
      isAdaptive: i.isAdaptive,
    }))
  }, [items])

  if (!courseCode) {
    return <Navigate to="/courses" replace />
  }

  return (
    <LmsPage
      title="Calendar"
      description={`Assignments and due dates for course ${courseCode}.`}
    >
      {error && (
        <p className="mt-6 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-200">
          {error}
        </p>
      )}
      {!error && items === null && (
        <p className="mt-8 text-sm text-slate-500 dark:text-neutral-400">Loading…</p>
      )}
      {!error && items !== null && (
        <CourseCalendar
          courseCode={courseCode}
          assignments={assignments}
          canRescheduleDueByDrag={canRescheduleDueByDrag}
          onDueDatesChanged={load}
        />
      )}
    </LmsPage>
  )
}
