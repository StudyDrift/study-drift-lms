import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { NotebookPen } from 'lucide-react'
import { authorizedFetch } from '../../lib/api'
import { type Course } from '../../lib/coursesApi'
import { readApiErrorMessage } from '../../lib/errors'
import {
  listStudentCourseNotebooks,
  subscribeStudentNotebooks,
} from '../../lib/studentNotebookStorage'
import { LmsPage } from './LmsPage'

function snippet(text: string, max = 140): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  return `${t.slice(0, max - 1)}…`
}

export default function MyNotebooksPage() {
  const [courses, setCourses] = useState<Course[] | null>(null)
  const [coursesError, setCoursesError] = useState<string | null>(null)
  const [notebookVersion, setNotebookVersion] = useState(0)

  const refreshNotebooks = useCallback(() => {
    setNotebookVersion((n) => n + 1)
  }, [])

  useEffect(() => {
    return subscribeStudentNotebooks(refreshNotebooks)
  }, [refreshNotebooks])

  useEffect(() => {
    let cancelled = false
    setCoursesError(null)
    void (async () => {
      try {
        const res = await authorizedFetch('/api/v1/courses')
        const raw: unknown = await res.json().catch(() => ({}))
        if (!res.ok) {
          if (!cancelled) {
            setCourses([])
            setCoursesError(readApiErrorMessage(raw))
          }
          return
        }
        const data = raw as { courses?: Course[] }
        if (!cancelled) setCourses(data.courses ?? [])
      } catch {
        if (!cancelled) {
          setCourses([])
          setCoursesError('Could not load courses.')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const titleByCode = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of courses ?? []) {
      m.set(c.courseCode, c.title)
    }
    return m
  }, [courses])

  const entries = useMemo(() => {
    const stored = listStudentCourseNotebooks()
    const rows = Object.entries(stored)
      .map(([courseCode, row]) => ({
        courseCode,
        body: row.body,
        updatedAt: row.updatedAt,
        courseTitle: row.courseTitle ?? titleByCode.get(courseCode) ?? courseCode,
      }))
      .filter((r) => r.body.trim().length > 0)
    rows.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    return rows
  }, [titleByCode, courses, notebookVersion])

  return (
    <LmsPage
      title="My Notebooks"
      description="Your private notes from each course, on this device."
    >
      {coursesError && (
        <p className="mt-6 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-200">
          {coursesError}
        </p>
      )}

      {courses === null && !coursesError && (
        <p className="mt-8 text-sm text-slate-500 dark:text-neutral-400">Loading…</p>
      )}

      {courses !== null && entries.length === 0 && (
        <p className="mt-8 max-w-xl text-sm text-slate-600 dark:text-neutral-300">
          You do not have any saved notes yet. Open a course and use{' '}
          <span className="font-medium text-slate-800 dark:text-neutral-100">Notebook</span> in the
          course menu to write thoughts while you learn.
        </p>
      )}

      {entries.length > 0 && (
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {entries.map((e) => (
            <li key={e.courseCode}>
              <Link
                to={`/courses/${encodeURIComponent(e.courseCode)}/notebook`}
                className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-indigo-200 hover:shadow-md dark:border-neutral-700 dark:bg-neutral-950 dark:hover:border-indigo-500/40"
              >
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700 dark:bg-indigo-950/80 dark:text-indigo-200">
                    <NotebookPen className="h-5 w-5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-slate-900 dark:text-neutral-100">
                      {e.courseTitle}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-neutral-400">
                      {e.courseCode} ·{' '}
                      {new Date(e.updatedAt).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </p>
                  </div>
                </div>
                <p className="mt-3 line-clamp-4 text-sm leading-relaxed text-slate-600 dark:text-neutral-300">
                  {snippet(e.body)}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </LmsPage>
  )
}
