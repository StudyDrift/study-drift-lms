import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { LmsPage } from './lms-page'
import { authorizedFetch } from '../../lib/api'
import { postCourseContext, type CoursePublic } from '../../lib/courses-api'
import { readApiErrorMessage } from '../../lib/errors'
import { heroImageObjectStyle } from '../../lib/hero-image-position'

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function formatIsoDurationHuman(iso: string | null | undefined): string {
  if (!iso?.trim()) return '—'
  const m = /^P(\d+)([DWMY])$/i.exec(iso.trim())
  if (!m) return iso
  const n = m[1]
  const labels: Record<string, string> = {
    D: 'days',
    W: 'weeks',
    M: 'months',
    Y: 'years',
  }
  const u = labels[m[2].toUpperCase()] ?? 'periods'
  return `${n} ${u}`
}

export default function CourseDetail() {
  const { courseCode } = useParams<{ courseCode: string }>()
  const [course, setCourse] = useState<CoursePublic | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!courseCode) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await authorizedFetch(`/api/v1/courses/${encodeURIComponent(courseCode)}`)
        const raw: unknown = await res.json().catch(() => ({}))
        if (!res.ok) {
          setCourse(null)
          setError(readApiErrorMessage(raw))
          return
        }
        if (!cancelled) {
          setCourse(raw as CoursePublic)
          void postCourseContext(courseCode, { kind: 'course_visit' }).catch(() => {})
        }
      } catch {
        if (!cancelled) {
          setCourse(null)
          setError('Could not load this course.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [courseCode])

  if (!courseCode) {
    return (
      <LmsPage title="Course" description="">
        <p className="mt-6 text-sm text-slate-500">Invalid link.</p>
      </LmsPage>
    )
  }

  return (
    <LmsPage
      title={course?.title ?? (loading ? 'Loading…' : 'Course')}
      description={course?.description ?? ''}
    >
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Link to="/courses" className="text-sm font-medium text-indigo-600 hover:text-indigo-500">
          ← All courses
        </Link>
        {courseCode && (
          <Link
            to={`/courses/${encodeURIComponent(courseCode)}/settings`}
            className="text-sm font-medium text-indigo-600 hover:text-indigo-500"
          >
            Course settings
          </Link>
        )}
      </div>

      {loading && <p className="mt-6 text-sm text-slate-500">Loading…</p>}
      {error && (
        <p className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </p>
      )}

      {course && !loading && (
        <>
          {course.heroImageUrl && (
            <img
              src={course.heroImageUrl}
              alt=""
              className="mt-8 max-h-64 w-full max-w-xl rounded-2xl border border-slate-200 object-cover"
              style={heroImageObjectStyle(course.heroImageObjectPosition)}
            />
          )}
          <dl className="mt-8 grid max-w-xl gap-4 text-sm">
            <div>
              <dt className="font-medium text-slate-500">Course code</dt>
              <dd className="mt-1 text-slate-900">{course.courseCode}</dd>
            </div>
            {course.scheduleMode === 'relative' &&
            course.viewerEnrollmentRoles?.some(
              (r) => r === 'teacher' || r === 'instructor',
            ) ? (
              <>
                <div>
                  <dt className="font-medium text-slate-500">Schedule</dt>
                  <dd className="mt-1 text-slate-900">
                    Relative to each student&apos;s enrollment. Module release and due dates are
                    shifted from the course timeline anchor (see course settings).
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-500">Course length</dt>
                  <dd className="mt-1 text-slate-900">
                    {course.relativeEndAfter
                      ? `${formatIsoDurationHuman(course.relativeEndAfter)} after enrollment`
                      : 'No fixed end'}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-500">Catalog visibility</dt>
                  <dd className="mt-1 text-slate-900">
                    {course.relativeHiddenAfter
                      ? `Hidden ${formatIsoDurationHuman(course.relativeHiddenAfter)} after enrollment`
                      : 'Not limited by a hide-after duration'}
                  </dd>
                </div>
              </>
            ) : (
              <>
                <div>
                  <dt className="font-medium text-slate-500">Starts / ends</dt>
                  <dd className="mt-1 text-slate-900">
                    {formatDate(course.startsAt)} — {formatDate(course.endsAt)}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-500">Visible / hidden window</dt>
                  <dd className="mt-1 text-slate-900">
                    {formatDate(course.visibleFrom)} — {formatDate(course.hiddenAt)}
                  </dd>
                </div>
              </>
            )}
            <div>
              <dt className="font-medium text-slate-500">Published</dt>
              <dd className="mt-1 text-slate-900">{course.published ? 'Yes' : 'No'}</dd>
            </div>
          </dl>
        </>
      )}
    </LmsPage>
  )
}
