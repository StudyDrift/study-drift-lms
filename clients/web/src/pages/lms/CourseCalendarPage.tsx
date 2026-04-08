import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { fetchCourseStructure } from '../../lib/coursesApi'
import { CourseCalendar, type CourseCalendarAssignment } from './CourseCalendar'
import { LmsPage } from './LmsPage'

export default function CourseCalendarPage() {
  const { courseCode } = useParams<{ courseCode: string }>()
  const [items, setItems] = useState<Awaited<ReturnType<typeof fetchCourseStructure>> | null>(null)
  const [error, setError] = useState<string | null>(null)

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
    return items
      .filter((i) => i.kind === 'content_page' && i.dueAt)
      .map((i) => ({
        id: i.id,
        title: i.title,
        dueAt: i.dueAt as string,
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
        <p className="mt-6 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </p>
      )}
      {!error && items === null && (
        <p className="mt-8 text-sm text-slate-500">Loading…</p>
      )}
      {!error && items !== null && <CourseCalendar courseCode={courseCode} assignments={assignments} />}
    </LmsPage>
  )
}
