import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { HelpCircle, Info, MoreHorizontal, Plus, User } from 'lucide-react'
import { LmsPage } from './LmsPage'
import { RequirePermission } from '../../components/RequirePermission'
import { authorizedFetch } from '../../lib/api'
import { type Course } from '../../lib/coursesApi'
import { readApiErrorMessage } from '../../lib/errors'
import { PERM_COURSE_CREATE } from '../../lib/rbacApi'
import { heroImageObjectStyle } from '../../lib/heroImagePosition'

export type { Course } from '../../lib/coursesApi'

function formatEditedAgo(iso: string): string {
  const d = new Date(iso)
  const diffMs = Date.now() - d.getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'Edited just now'
  if (mins < 60) return `Edited ${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `Edited ${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `Edited ${days}d ago`
}

function hashPercent(seed: string, n: number): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return 35 + ((h + n * 17) % 50)
}

function RingStat({
  label,
  percent,
  strokeClass,
}: {
  label: string
  percent: number
  strokeClass: string
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative h-[3.25rem] w-[3.25rem]">
        <svg className="-rotate-90" viewBox="0 0 36 36" aria-hidden>
          <circle
            cx="18"
            cy="18"
            r="15.5"
            pathLength={100}
            fill="none"
            className="stroke-slate-100"
            strokeWidth="3"
          />
          <circle
            cx="18"
            cy="18"
            r="15.5"
            pathLength={100}
            fill="none"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={100}
            strokeDashoffset={100 - percent}
            className={strokeClass}
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold tabular-nums text-slate-800">
          {percent}%
        </span>
      </div>
      <div className="flex items-center gap-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
        {label}
        <Info className="h-3 w-3 text-slate-400" aria-hidden />
      </div>
    </div>
  )
}

function statusLabel(c: Course): string {
  const now = Date.now()
  if (c.endsAt && new Date(c.endsAt).getTime() < now) return 'Ended'
  if (c.startsAt && new Date(c.startsAt).getTime() > now) return 'Upcoming'
  return 'Active'
}

function tagFromCode(courseCode: string): string {
  const m = /^C-([A-Z0-9]{6})$/i.exec(courseCode.trim())
  if (m) return m[1].slice(0, 4).toUpperCase()
  const prefix = courseCode.split(/[-\s]/)[0]?.toUpperCase() ?? 'Course'
  if (prefix.length <= 4) return prefix
  return prefix.slice(0, 4)
}

function CourseCard({ course }: { course: Course }) {
  const acc = hashPercent(course.id, 1)
  const comp = hashPercent(course.id, 2)
  const tag = tagFromCode(course.courseCode)
  const courseHref = `/courses/${encodeURIComponent(course.courseCode)}`

  return (
    <article className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-900/5">
      <Link
        to={courseHref}
        className="relative block focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
        aria-label={`Open ${course.title}`}
      >
        <img
          src={course.heroImageUrl ?? '/course-card-hero.png'}
          alt=""
          className="h-36 w-full object-cover"
          style={heroImageObjectStyle(course.heroImageObjectPosition)}
        />
        <span className="absolute left-3 top-3 rounded-full bg-slate-900/70 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
          {statusLabel(course)}
        </span>
      </Link>

      <div className="flex flex-1 flex-col p-5">
        <Link
          to={courseHref}
          className="text-base font-semibold leading-snug text-slate-900 hover:text-indigo-600"
        >
          {course.title}
        </Link>

        <div className="mt-5 flex justify-center gap-8 border-t border-slate-100 pt-5">
          <RingStat label="Accuracy" percent={acc} strokeClass="stroke-teal-500" />
          <RingStat label="Completion" percent={comp} strokeClass="stroke-emerald-500" />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
            {tag}
          </span>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
            {course.published ? 'Published' : 'Draft'}
          </span>
          <span
            className="ml-auto flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500"
            aria-hidden
          >
            <User className="h-4 w-4" />
          </span>
        </div>

        <div className="mt-4 flex items-center gap-3 border-t border-slate-100 pt-4 text-xs text-slate-500">
          <span className="min-w-0 flex-1 truncate">{formatEditedAgo(course.updatedAt)}</span>
          <span className="inline-flex items-center gap-1 tabular-nums">
            <HelpCircle className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
            —
          </span>
          <button
            type="button"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm hover:bg-slate-50"
            aria-label="More options"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </div>
      </div>
    </article>
  )
}

export default function Courses() {
  const [courses, setCourses] = useState<Course[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setError(null)
      try {
        const res = await authorizedFetch('/api/v1/courses')
        const raw: unknown = await res.json().catch(() => ({}))
        if (!res.ok) {
          setCourses([])
          setError(readApiErrorMessage(raw))
          return
        }
        const data = raw as { courses?: Course[] }
        if (!cancelled) setCourses(data.courses ?? [])
      } catch {
        if (!cancelled) {
          setCourses([])
          setError('Could not load courses. Is the API running?')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <LmsPage
      title="Courses"
      description="Browse and open your enrolled courses."
      actions={
        <RequirePermission permission={PERM_COURSE_CREATE} fallback={null}>
          <Link
            to="/courses/create"
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 sm:w-auto"
          >
            <Plus className="h-4 w-4" aria-hidden />
            New course
          </Link>
        </RequirePermission>
      }
    >
      {error && (
        <p className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </p>
      )}

      {courses === null && !error && (
        <p className="mt-8 text-sm text-slate-500">Loading courses…</p>
      )}

      {courses && courses.length === 0 && !error && (
        <p className="mt-8 text-sm text-slate-500">No published courses yet.</p>
      )}

      {courses && courses.length > 0 && (
        <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {courses.map((c) => (
            <CourseCard key={c.id} course={c} />
          ))}
        </div>
      )}
    </LmsPage>
  )
}
