import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  ClipboardList,
  LayoutDashboard,
  Megaphone,
} from 'lucide-react'
import { LmsPage } from './lms-page'
import { authorizedFetch } from '../../lib/api'
import {
  courseGradebookViewPermission,
  fetchCourseGradebookGrid,
  fetchCourseMyGrades,
  fetchCourseStructure,
  fetchEnrollmentDiagnostic,
  fetchLearnerRecommendations,
  postCourseContext,
  viewerIsCourseStaffEnrollment,
  viewerShouldShowMyGradesNav,
  type CourseGradebookGridResponse,
  type CourseMyGradesResponse,
  type CoursePublic,
  type CourseStructureItem,
  type RecommendationItem,
} from '../../lib/courses-api'
import { fetchFeedChannels, fetchFeedMessages } from '../../lib/course-feed-api'
import { readApiErrorMessage } from '../../lib/errors'
import { formatAbsolute } from '../../lib/format-datetime'
import { formatTimeAgoFromIso } from '../../lib/format-time-ago'
import { getLastVisitedForCourse, hrefForLastVisited } from '../../lib/last-visited-module-item'
import { heroImageObjectStyle } from '../../lib/hero-image-position'
import { getJwtSubject } from '../../lib/auth'
import { hrefForRecommendationItem, surfaceLabel } from '../../lib/recommendation-nav'
import { CourseVisibilityPill } from '../../components/ui/status-vocabulary'
import { useCourseNavFeatures } from '../../context/course-nav-features-context'
import { usePermissions } from '../../context/use-permissions'
import { getCourseViewAs } from '../../lib/course-view-as'
import { permCourseItemsCreate } from '../../lib/rbac-api'
import { CourseCalendar, type CourseCalendarAssignment } from './course-calendar'
import { formatDueShort } from '../../lib/course-calendar-utils'

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

function normalizeCourseHomeLanding(v: string | undefined): 'data' | 'calendar' | 'content_page' {
  if (v === 'calendar' || v === 'content_page') return v
  return 'data'
}

function startOfWeekMonday(now = new Date()): Date {
  const d = new Date(now)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

function endOfWeekSunday(start: Date): Date {
  const e = new Date(start)
  e.setDate(start.getDate() + 6)
  e.setHours(23, 59, 59, 999)
  return e
}

function dueThisWeekItems(
  structure: CourseStructureItem[],
  weekStart: Date,
  weekEnd: Date,
): CourseStructureItem[] {
  const t0 = weekStart.getTime()
  const t1 = weekEnd.getTime()
  const out: CourseStructureItem[] = []
  for (const it of structure) {
    if (!it.dueAt) continue
    if (it.kind !== 'assignment' && it.kind !== 'quiz' && it.kind !== 'content_page') continue
    const t = new Date(it.dueAt).getTime()
    if (Number.isNaN(t) || t < t0 || t > t1) continue
    out.push(it)
  }
  out.sort((a, b) => new Date(a.dueAt!).getTime() - new Date(b.dueAt!).getTime())
  return out
}

function feedSnippet(body: string, max = 140): string {
  const t = body
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/[#*_`[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!t) return ''
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`
}

function gradeSnippetForItem(
  my: CourseMyGradesResponse | null,
  itemId: string,
): { label: string; pct: number } | null {
  if (!my) return null
  const col = my.columns.find((c) => c.id === itemId)
  if (!col || col.maxPoints == null || col.maxPoints <= 0) return null
  const raw = my.grades[itemId]
  const earned = raw != null && String(raw).trim() !== '' ? Number.parseFloat(String(raw).replace(/,/g, '')) : NaN
  if (!Number.isFinite(earned)) return { label: 'Not submitted', pct: 0 }
  const pct = Math.max(0, Math.min(100, (earned / col.maxPoints) * 100))
  return { label: `${earned}/${col.maxPoints} pts`, pct }
}

function itemHref(courseCode: string, it: CourseStructureItem): string {
  const base = `/courses/${encodeURIComponent(courseCode)}/modules`
  if (it.kind === 'assignment') return `${base}/assignment/${encodeURIComponent(it.id)}`
  if (it.kind === 'quiz') return `${base}/quiz/${encodeURIComponent(it.id)}`
  return `${base}/content/${encodeURIComponent(it.id)}`
}

type AnnouncementPreview = {
  channelName: string
  snippet: string
  author: string
  createdAt: string
  pinned: boolean
}

async function loadAnnouncementPreview(course: CoursePublic): Promise<AnnouncementPreview | null> {
  if (course.feedEnabled === false) return null
  try {
    const channels = await fetchFeedChannels(course.courseCode)
    if (!channels.length) return null
    const sorted = [...channels].sort((a, b) => a.sortOrder - b.sortOrder)
    const preferred =
      sorted.find((c) => c.name.toLowerCase().includes('announce')) ??
      sorted.find((c) => c.name.toLowerCase() === 'general') ??
      sorted[0]
    const messages = await fetchFeedMessages(course.courseCode, preferred.id)
    const roots = messages.filter((m) => !m.parentMessageId)
    const viewer = getJwtSubject()?.toLowerCase() ?? ''
    const ranked = [...roots].sort((a, b) => {
      const ap = a.pinnedAt ? 1 : 0
      const bp = b.pinnedAt ? 1 : 0
      if (ap !== bp) return bp - ap
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    })
    const pick =
      ranked.find((m) => m.authorUserId.toLowerCase() !== viewer) ?? ranked[0] ?? null
    if (!pick) return null
    const snip = feedSnippet(pick.body)
    if (!snip) return null
    return {
      channelName: preferred.name,
      snippet: snip,
      author: pick.authorDisplayName?.trim() || pick.authorEmail || 'Someone',
      createdAt: pick.createdAt,
      pinned: Boolean(pick.pinnedAt),
    }
  } catch {
    return null
  }
}

function countEmptyGradeCells(grid: CourseGradebookGridResponse): number {
  const { students, columns, grades = {} } = grid
  let n = 0
  for (const col of columns) {
    if (col.maxPoints == null || col.maxPoints <= 0) continue
    for (const s of students) {
      const cell = grades[s.userId]?.[col.id]
      if (cell == null || String(cell).trim() === '') n++
    }
  }
  return n
}

export default function CourseDetail() {
  const { courseCode } = useParams<{ courseCode: string }>()
  const [searchParams] = useSearchParams()
  const dateKey = searchParams.get('date')?.trim() || null
  const { calendarEnabled: courseCalendarEnabled, loading: courseFeatureFlagsLoading } =
    useCourseNavFeatures()
  const { allows, loading: permLoading } = usePermissions()

  const [course, setCourse] = useState<CoursePublic | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [diagnosticPending, setDiagnosticPending] = useState(false)
  const [courseRecs, setCourseRecs] = useState<RecommendationItem[]>([])

  const [structure, setStructure] = useState<CourseStructureItem[] | null>(null)
  const [structureError, setStructureError] = useState<string | null>(null)
  const [myGrades, setMyGrades] = useState<CourseMyGradesResponse | null>(null)
  const [announcement, setAnnouncement] = useState<AnnouncementPreview | null>(null)
  const [gradebookEmptyCells, setGradebookEmptyCells] = useState<number | null>(null)

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

  const landing = useMemo((): 'data' | 'calendar' | 'content_page' => {
    if (!course) return 'data'
    const n = normalizeCourseHomeLanding(course.courseHomeLanding)
    if (n === 'content_page' && !course.courseHomeContentItemId?.trim()) return 'data'
    return n
  }, [course])

  useEffect(() => {
    if (!courseCode || !course) return
    if (landing === 'content_page') return
    let cancelled = false
    void (async () => {
      setStructureError(null)
      try {
        const items = await fetchCourseStructure(courseCode)
        if (!cancelled) setStructure(items)
      } catch {
        if (!cancelled) {
          setStructure([])
          setStructureError('Could not load course outline.')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [courseCode, course, landing])

  useEffect(() => {
    if (!courseCode || !course || landing !== 'data') return
    let cancelled = false
    void (async () => {
      const preview = getCourseViewAs(courseCode)
      const tasks: Promise<void>[] = []

      tasks.push(
        loadAnnouncementPreview(course).then((a) => {
          if (!cancelled) setAnnouncement(a)
        }),
      )

      if (viewerShouldShowMyGradesNav(course.viewerEnrollmentRoles, preview)) {
        tasks.push(
          fetchCourseMyGrades(courseCode)
            .then((g) => {
              if (!cancelled) setMyGrades(g)
            })
            .catch(() => {
              if (!cancelled) setMyGrades(null)
            }),
        )
      } else if (!cancelled) {
        setMyGrades(null)
      }

      const staff = viewerIsCourseStaffEnrollment(course.viewerEnrollmentRoles)
      if (staff && !permLoading && allows(courseGradebookViewPermission(courseCode))) {
        tasks.push(
          fetchCourseGradebookGrid(courseCode)
            .then((grid) => {
              if (!cancelled) setGradebookEmptyCells(countEmptyGradeCells(grid))
            })
            .catch(() => {
              if (!cancelled) setGradebookEmptyCells(null)
            }),
        )
      } else if (!cancelled) {
        setGradebookEmptyCells(null)
      }

      await Promise.all(tasks)
    })()
    return () => {
      cancelled = true
    }
  }, [courseCode, course, landing, allows, permLoading])

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

  const weekStart = useMemo(() => startOfWeekMonday(), [])
  const weekEnd = useMemo(() => endOfWeekSunday(weekStart), [weekStart])
  const dueWeek = useMemo(() => {
    if (!structure) return []
    return dueThisWeekItems(structure, weekStart, weekEnd)
  }, [structure, weekStart, weekEnd])

  const calendarAssignments: CourseCalendarAssignment[] = useMemo(() => {
    if (!structure) return []
    const isDueCalendarItem = (
      i: CourseStructureItem,
    ): i is CourseStructureItem & {
      kind: 'content_page' | 'assignment' | 'quiz'
      dueAt: string
    } =>
      (i.kind === 'content_page' || i.kind === 'assignment' || i.kind === 'quiz') && Boolean(i.dueAt)

    return structure.filter(isDueCalendarItem).map((i) => ({
      id: i.id,
      title: i.title,
      dueAt: i.dueAt,
      kind: i.kind,
      pointsWorth: i.pointsWorth,
      pointsPossible: i.pointsPossible,
      isAdaptive: i.isAdaptive,
    }))
  }, [structure])

  const canRescheduleDueByDrag = Boolean(
    courseCode && !permLoading && allows(permCourseItemsCreate(courseCode)),
  )

  if (!courseCode) {
    return (
      <LmsPage title="Course" description="">
        <p className="mt-6 text-sm text-slate-500">Invalid link.</p>
      </LmsPage>
    )
  }

  if (
    course &&
    normalizeCourseHomeLanding(course.courseHomeLanding) === 'content_page' &&
    course.courseHomeContentItemId?.trim()
  ) {
    return (
      <Navigate
        to={`/courses/${encodeURIComponent(courseCode)}/modules/content/${encodeURIComponent(course.courseHomeContentItemId)}`}
        replace
      />
    )
  }

  const lastVisited = getLastVisitedForCourse(courseCode)
  const staff = course ? viewerIsCourseStaffEnrollment(course.viewerEnrollmentRoles) : false

  return (
    <LmsPage
      title={course?.title ?? (loading ? 'Loading…' : 'Course')}
      description={course?.description ?? ''}
      fillHeight={landing === 'calendar'}
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
        {course?.isBlueprint ? (
          <span
            className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-semibold text-indigo-900 dark:bg-indigo-950 dark:text-indigo-100"
            title="This course is a district blueprint master"
          >
            Blueprint master
          </span>
        ) : null}
        {course?.blueprintParentCourseCode ? (
          <span
            className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-800 dark:bg-neutral-800 dark:text-neutral-100"
            title="Linked to a district blueprint course"
          >
            Blueprint child ({course.blueprintParentCourseCode})
          </span>
        ) : null}
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

          {landing === 'calendar' ? (
            <div className="mt-8 space-y-4">
              {!courseFeatureFlagsLoading && !courseCalendarEnabled ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50/90 p-4 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-50">
                  <p className="font-medium">Course calendar is turned off</p>
                  <p className="mt-1 text-amber-900/90 dark:text-amber-100/90">
                    Turn on <strong>Calendar</strong> under Course settings → Features, or change the
                    course home under General.
                  </p>
                  <Link
                    to={`/courses/${encodeURIComponent(courseCode)}/settings/features`}
                    className="mt-3 inline-block text-sm font-semibold text-amber-900 underline dark:text-amber-100"
                  >
                    Open Features
                  </Link>
                </div>
              ) : null}
              {structureError && (
                <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                  {structureError}
                </p>
              )}
              {!structureError && structure === null && (
                <p className="text-sm text-slate-500 dark:text-neutral-400">Loading calendar…</p>
              )}
              {!structureError && structure !== null && courseCalendarEnabled && (
                <CourseCalendar
                  courseCode={courseCode}
                  assignments={calendarAssignments}
                  canRescheduleDueByDrag={canRescheduleDueByDrag}
                  onDueDatesChanged={() => {
                    void fetchCourseStructure(courseCode).then(setStructure).catch(() => setStructure([]))
                  }}
                  initialDateKey={dateKey}
                />
              )}
            </div>
          ) : null}

          {landing === 'data' ? (
            <>
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

              <section aria-label="Course overview" className="mt-8">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-neutral-400">
                  At a glance
                </h2>
                <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
                    <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400">
                      <CalendarDays className="h-5 w-5 shrink-0" aria-hidden />
                      <span className="text-sm font-semibold text-slate-900 dark:text-neutral-50">
                        This week
                      </span>
                    </div>
                    <p className="mt-2 text-3xl font-bold tabular-nums text-slate-900 dark:text-neutral-50">
                      {dueWeek.length}
                    </p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-neutral-400">Items due in the next 7 days</p>
                    {dueWeek.length > 0 ? (
                      <ul className="mt-3 space-y-2 border-t border-slate-100 pt-3 dark:border-neutral-800">
                        {dueWeek.slice(0, 4).map((it) => (
                          <li key={it.id}>
                            <Link
                              to={itemHref(courseCode, it)}
                              className="flex flex-col gap-0.5 text-sm text-indigo-700 hover:text-indigo-500 dark:text-indigo-300 dark:hover:text-indigo-200"
                            >
                              <span className="font-medium text-slate-900 dark:text-neutral-100">{it.title}</span>
                              <span className="text-xs text-slate-500 dark:text-neutral-400">
                                {formatDueShort(it.dueAt!)}
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-3 text-xs text-slate-500 dark:text-neutral-400">Nothing due this week.</p>
                    )}
                    <Link
                      to={`/courses/${encodeURIComponent(courseCode)}/calendar`}
                      className="mt-4 inline-flex text-xs font-semibold text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
                    >
                      Open full calendar →
                    </Link>
                  </div>

                  {announcement ? (
                    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
                      <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400">
                        <Megaphone className="h-5 w-5 shrink-0" aria-hidden />
                        <span className="text-sm font-semibold text-slate-900 dark:text-neutral-50">
                          {announcement.channelName}
                          {announcement.pinned ? (
                            <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-900 dark:bg-amber-950 dark:text-amber-100">
                              Pinned
                            </span>
                          ) : null}
                        </span>
                      </div>
                      <p className="mt-2 line-clamp-4 text-sm text-slate-700 dark:text-neutral-300">
                        {announcement.snippet}
                      </p>
                      <p className="mt-2 text-xs text-slate-500 dark:text-neutral-500">
                        {announcement.author} · {formatTimeAgoFromIso(announcement.createdAt)}
                      </p>
                      <Link
                        to={`/courses/${encodeURIComponent(courseCode)}/feed`}
                        className="mt-4 inline-flex text-xs font-semibold text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
                      >
                        Open course feed →
                      </Link>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 p-5 dark:border-neutral-700 dark:bg-neutral-900/50">
                      <div className="flex items-center gap-2 text-slate-500 dark:text-neutral-400">
                        <Megaphone className="h-5 w-5 shrink-0" aria-hidden />
                        <span className="text-sm font-semibold text-slate-700 dark:text-neutral-200">
                          Announcements
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-slate-500 dark:text-neutral-400">
                        No recent announcement to preview, or the feed is off for this course.
                      </p>
                    </div>
                  )}

                  {viewerIsStudent && myGrades && myGrades.columns.some((c) => c.maxPoints && c.maxPoints > 0) ? (
                    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
                      <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400">
                        <BarChart3 className="h-5 w-5 shrink-0" aria-hidden />
                        <span className="text-sm font-semibold text-slate-900 dark:text-neutral-50">Grades</span>
                      </div>
                      <ul className="mt-3 max-h-40 space-y-2 overflow-y-auto text-sm">
                        {myGrades.columns
                          .filter((c) => c.maxPoints != null && c.maxPoints > 0)
                          .slice(0, 6)
                          .map((c) => {
                            const sn = gradeSnippetForItem(myGrades, c.id)
                            return (
                              <li
                                key={c.id}
                                className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2 last:border-0 dark:border-neutral-800"
                              >
                                <span className="truncate font-medium text-slate-800 dark:text-neutral-200">
                                  {c.title}
                                </span>
                                {sn ? (
                                  <span className="shrink-0 text-xs text-slate-600 dark:text-neutral-400">
                                    {sn.label}
                                  </span>
                                ) : (
                                  <span className="shrink-0 text-xs text-slate-400">—</span>
                                )}
                              </li>
                            )
                          })}
                      </ul>
                      <Link
                        to={`/courses/${encodeURIComponent(courseCode)}/my-grades`}
                        className="mt-4 inline-flex text-xs font-semibold text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
                      >
                        My grades →
                      </Link>
                    </div>
                  ) : null}

                  {staff ? (
                    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-neutral-700 dark:bg-neutral-900 sm:col-span-2 lg:col-span-1">
                      <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400">
                        <LayoutDashboard className="h-5 w-5 shrink-0" aria-hidden />
                        <span className="text-sm font-semibold text-slate-900 dark:text-neutral-50">Teaching</span>
                      </div>
                      <p className="mt-2 text-sm text-slate-600 dark:text-neutral-400">
                        {gradebookEmptyCells != null
                          ? `${gradebookEmptyCells} empty grade cell${gradebookEmptyCells === 1 ? '' : 's'} in the gradebook.`
                          : 'Open the gradebook to review submissions and scores.'}
                      </p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Link
                          to={`/courses/${encodeURIComponent(courseCode)}/gradebook`}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-500"
                        >
                          <ClipboardList className="h-3.5 w-3.5" aria-hidden />
                          Gradebook
                        </Link>
                        <Link
                          to={`/courses/${encodeURIComponent(courseCode)}/modules`}
                          className="inline-flex rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-800 hover:border-indigo-200 dark:border-neutral-600 dark:text-neutral-100"
                        >
                          Modules
                        </Link>
                        <Link
                          to={`/courses/${encodeURIComponent(courseCode)}/enrollments`}
                          className="inline-flex rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-800 hover:border-indigo-200 dark:border-neutral-600 dark:text-neutral-100"
                        >
                          People
                        </Link>
                      </div>
                    </div>
                  ) : null}
                </div>
              </section>

              {course.heroImageUrl && (
                <img
                  src={course.heroImageUrl}
                  alt=""
                  className="mt-8 max-h-64 w-full max-w-xl rounded-2xl border border-slate-200 object-cover"
                  style={heroImageObjectStyle(course.heroImageObjectPosition)}
                />
              )}
              <details className="group mt-8 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
                <summary className="cursor-pointer list-none text-sm font-semibold text-slate-800 marker:hidden dark:text-neutral-100 [&::-webkit-details-marker]:hidden">
                  <span className="inline-flex items-center gap-2">
                    Course details
                    <span className="text-xs font-normal text-slate-500 group-open:hidden dark:text-neutral-400">
                      (show)
                    </span>
                  </span>
                </summary>
                <dl className="mt-4 grid max-w-xl gap-4 text-sm">
                  <div>
                    <dt className="font-medium text-slate-500">Course code</dt>
                    <dd className="mt-1 text-slate-900 dark:text-neutral-100">{course.courseCode}</dd>
                  </div>
                  {course.scheduleMode === 'relative' &&
                  course.viewerEnrollmentRoles?.some((r) => r === 'teacher' || r === 'instructor') ? (
                    <>
                      <div>
                        <dt className="font-medium text-slate-500">Schedule</dt>
                        <dd className="mt-1 text-slate-900 dark:text-neutral-100">
                          Relative to each student&apos;s enrollment. Module release and due dates are shifted from the
                          course timeline anchor (see course settings).
                        </dd>
                      </div>
                      <div>
                        <dt className="font-medium text-slate-500">Course length</dt>
                        <dd className="mt-1 text-slate-900 dark:text-neutral-100">
                          {course.relativeEndAfter
                            ? `${formatIsoDurationHuman(course.relativeEndAfter)} after enrollment`
                            : 'No fixed end'}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-medium text-slate-500">Catalog visibility</dt>
                        <dd className="mt-1 text-slate-900 dark:text-neutral-100">
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
                        <dd className="mt-1 text-slate-900 dark:text-neutral-100">
                          {formatAbsolute(course.startsAt)} — {formatAbsolute(course.endsAt)}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-medium text-slate-500">Visible / hidden window</dt>
                        <dd className="mt-1 text-slate-900 dark:text-neutral-100">
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
              </details>
            </>
          ) : null}
        </>
      )}
    </LmsPage>
  )
}
