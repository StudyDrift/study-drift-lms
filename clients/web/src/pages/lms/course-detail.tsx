import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { LmsPage } from './lms-page'
import { authorizedFetch } from '../../lib/api'
import {
  fetchEnrollmentDiagnostic,
  fetchLearnerRecommendations,
  postCourseContext,
  type CoursePublic,
  type RecommendationItem,
} from '../../lib/courses-api'
import { readApiErrorMessage } from '../../lib/errors'
import { formatAbsolute } from '../../lib/format-datetime'
import { formatTimeAgoFromIso } from '../../lib/format-time-ago'
import { getLastVisitedForCourse, hrefForLastVisited } from '../../lib/last-visited-module-item'
import { heroImageObjectStyle } from '../../lib/hero-image-position'
import { getJwtSubject } from '../../lib/auth'
import { hrefForRecommendationItem, surfaceLabel } from '../../lib/recommendation-nav'
import { CourseVisibilityPill } from '../../components/ui/status-vocabulary'

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
  const [diagnosticPending, setDiagnosticPending] = useState(false)
  const [courseRecs, setCourseRecs] = useState<RecommendationItem[]>([])

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
          const c = raw as CoursePublic
          setCourse(c)
          void postCourseContext(courseCode, { kind: 'course_visit' }).catch(() => {})
          const eid = c.viewerStudentEnrollmentId
          if (eid && c.diagnosticAssessmentsEnabled === true) {
            fetchEnrollmentDiagnostic(eid)
              .then((g) => {
                if (!cancelled && g.status === 'pending') setDiagnosticPending(true)
                else if (!cancelled) setDiagnosticPending(false)
              })
              .catch(() => {
                if (!cancelled) setDiagnosticPending(false)
              })
          } else if (!cancelled) {
            setDiagnosticPending(false)
          }
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

  const viewerIsStudent =
    course?.viewerEnrollmentRoles?.some((r) => r.trim().toLowerCase() === 'student') ?? false

  useEffect(() => {
    const uid = getJwtSubject()
    if (!uid || !course?.id || !viewerIsStudent) {
      setCourseRecs([])
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const [a, b] = await Promise.all([
          fetchLearnerRecommendations(uid, course.id, 'continue', { limit: 3 }),
          fetchLearnerRecommendations(uid, course.id, 'strengthen', { limit: 3 }),
        ])
        if (cancelled) return
        const merged = [...a.recommendations, ...b.recommendations]
        merged.sort((x, y) => y.score - x.score)
        setCourseRecs(merged.slice(0, 5))
      } catch {
        if (!cancelled) setCourseRecs([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [course?.id, viewerIsStudent])

  if (!courseCode) {
    return (
      <LmsPage title="Course" description="">
        <p className="mt-6 text-sm text-slate-500">Invalid link.</p>
      </LmsPage>
    )
  }

  const lastVisited = getLastVisitedForCourse(courseCode)

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
            to={`/courses/${encodeURIComponent(courseCode)}/settings/general`}
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
          {diagnosticPending && courseCode ? (
            <section
              aria-label="Placement diagnostic"
              className="mt-6 rounded-2xl border border-amber-200 bg-amber-50/90 p-4 text-sm text-amber-950 shadow-sm dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-50"
            >
              <p className="font-medium">Take your placement check</p>
              <p className="mt-1 text-amber-900/90 dark:text-amber-100/90">
                A short adaptive assessment helps us suggest where to start in this course.
              </p>
              <Link
                to={`/courses/${encodeURIComponent(courseCode)}/diagnostic`}
                className="mt-3 inline-flex rounded-lg bg-amber-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 dark:bg-amber-600 dark:hover:bg-amber-500"
              >
                Open placement
              </Link>
            </section>
          ) : null}
          {viewerIsStudent && courseRecs.length > 0 && courseCode ? (
            <section aria-label="Suggestions for this course" className="mt-8">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-neutral-400">
                Suggested next steps
              </h2>
              <ul className="mt-3 space-y-2">
                {courseRecs.map((r, i) => (
                  <li
                    key={`${r.itemId}-${r.surface}-${i}`}
                    role="article"
                    aria-label={`${surfaceLabel(r.surface)}: ${r.title}`}
                  >
                    <Link
                      to={hrefForRecommendationItem(courseCode, r)}
                      className="block rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm transition hover:border-indigo-200 hover:bg-indigo-50/40 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:border-indigo-800 dark:hover:bg-indigo-950/30"
                    >
                      <span className="text-xs font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-300">
                        {surfaceLabel(r.surface)}
                      </span>
                      <p className="mt-1 font-medium text-slate-900 dark:text-neutral-50">{r.title}</p>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-neutral-400">{r.reason}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {lastVisited ? (
            <section aria-label="Continue where you left off" className="mt-8">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-neutral-400">
                Continue where you left off
              </h2>
              <div className="mt-3 rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/90 to-white p-5 shadow-sm dark:border-indigo-900/40 dark:from-indigo-950/40 dark:to-neutral-900">
                <p className="text-xs text-slate-500 dark:text-neutral-400">
                  Opened {formatTimeAgoFromIso(lastVisited.openedAt)}
                </p>
                <p className="mt-1 text-lg font-semibold tracking-tight text-slate-900 dark:text-neutral-50">
                  {lastVisited.title}
                </p>
                <Link
                  to={hrefForLastVisited(courseCode, lastVisited.kind, lastVisited.itemId)}
                  className="mt-4 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500"
                >
                  Continue
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              </div>
            </section>
          ) : null}
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
                    {formatAbsolute(course.startsAt)} — {formatAbsolute(course.endsAt)}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-500">Visible / hidden window</dt>
                  <dd className="mt-1 text-slate-900">
                    {formatAbsolute(course.visibleFrom)} — {formatAbsolute(course.hiddenAt)}
                  </dd>
                </div>
              </>
            )}
            <div>
              <dt className="font-medium text-slate-500">Published</dt>
              <dd className="mt-1 flex flex-wrap items-center gap-2 text-slate-900 dark:text-neutral-100">
                <CourseVisibilityPill published={course.published} size="md" />
                <span className="text-sm text-slate-600 dark:text-neutral-400">
                  {course.published ? 'Visible in catalog when dates allow' : 'Staff-only until published'}
                </span>
              </dd>
            </div>
          </dl>
        </>
      )}
    </LmsPage>
  )
}
