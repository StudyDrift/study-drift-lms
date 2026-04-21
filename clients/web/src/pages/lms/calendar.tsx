import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { authorizedFetch } from '../../lib/api'
import { readApiErrorMessage } from '../../lib/errors'
import { parseCalendarDateFromQuery } from '../../lib/command-palette-go-to'
import type { CoursePublic } from '../../lib/courses-api'
import { LmsPage } from './lms-page'

export default function Calendar() {
  const [searchParams] = useSearchParams()
  const rawDate = searchParams.get('date')?.trim() ?? ''
  const dateKey = useMemo(() => parseCalendarDateFromQuery(rawDate), [rawDate])

  const [courses, setCourses] = useState<CoursePublic[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setError(null)
      try {
        const res = await authorizedFetch('/api/v1/courses')
        const raw: unknown = await res.json().catch(() => ({}))
        if (!res.ok) {
          if (!cancelled) {
            setCourses([])
            setError(readApiErrorMessage(raw))
          }
          return
        }
        const data = raw as { courses?: CoursePublic[] }
        if (!cancelled) setCourses(data.courses ?? [])
      } catch {
        if (!cancelled) {
          setCourses([])
          setError('Could not load courses.')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const heading = dateKey
    ? new Date(dateKey + 'T12:00:00').toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    : 'Calendar'

  const withCalendar = useMemo(
    () => (courses ?? []).filter((c) => !c.archived && c.calendarEnabled !== false),
    [courses],
  )

  return (
    <LmsPage
      title={heading}
      description={
        dateKey
          ? 'Jump into a course calendar for this day. Times and due chips always use your local time zone once you are inside the course.'
          : 'Pick a day from search (try Cmd/Ctrl + K with a date like 2026-04-21) or open a course calendar from the course sidebar.'
      }
    >
      {error && (
        <p className="mt-6 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-200">
          {error}
        </p>
      )}
      {courses === null && !error && <p className="mt-8 text-sm text-slate-500 dark:text-neutral-400">Loading…</p>}
      {courses && courses.length === 0 && !error && (
        <p className="mt-8 text-sm text-slate-600 dark:text-neutral-300">No courses on your account yet.</p>
      )}
      {courses && courses.length > 0 && withCalendar.length === 0 && !error && (
        <p className="mt-8 text-sm text-slate-600 dark:text-neutral-300">
          No enrolled courses have the calendar tool enabled.
        </p>
      )}
      {dateKey && withCalendar.length > 0 ? (
        <ul className="mt-8 space-y-2">
          {withCalendar.map((c) => (
            <li key={c.id}>
              <Link
                to={`/courses/${encodeURIComponent(c.courseCode)}/calendar?date=${encodeURIComponent(dateKey)}`}
                className="block rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-900 shadow-sm transition hover:border-indigo-200 hover:bg-indigo-50/40 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:border-indigo-500/40 dark:hover:bg-neutral-800"
              >
                {c.title.trim() || c.courseCode}
                <span className="mt-0.5 block text-xs font-normal text-slate-500 dark:text-neutral-400">
                  Open course calendar
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {!dateKey && withCalendar.length > 0 ? (
        <p className="mt-8 text-sm text-slate-600 dark:text-neutral-300">
          Use the{' '}
          <kbd className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 font-mono text-xs dark:border-neutral-600 dark:bg-neutral-800">
            ⌘K
          </kbd>{' '}
          palette with a date, or choose a course under <span className="font-medium">Courses</span> and open its Calendar
          page.
        </p>
      ) : null}
    </LmsPage>
  )
}
