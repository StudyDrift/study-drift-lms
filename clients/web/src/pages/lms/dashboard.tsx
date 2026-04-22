import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  ClipboardList,
  Inbox,
  Megaphone,
  MessageCircle,
  Sparkles,
  Users,
  Flame,
} from 'lucide-react'
import { authorizedFetch } from '../../lib/api'
import { readApiErrorMessage } from '../../lib/errors'
import { mapPool } from '../../lib/async-pool'
import { fetchFeedChannels, fetchFeedMessages } from '../../lib/course-feed-api'
import { getCourseViewAs } from '../../lib/course-view-as'
import { getJwtSubject } from '../../lib/auth'
import {
  courseEnrollmentsReadPermission,
  courseGradebookViewPermission,
  fetchCourse,
  fetchCourseGradebookGrid,
  fetchCourseMyGrades,
  fetchCourseStructure,
  fetchLearnerRecommendations,
  fetchLearnerReviewStats,
  postRecommendationEvent,
  viewerIsCourseStaffEnrollment,
  viewerShouldShowMyGradesNav,
  type CourseGradebookGridResponse,
  type CourseMyGradesResponse,
  type CoursePublic,
  type CourseStructureItem,
  type RecommendationItem,
  type ReviewStatsPayload,
} from '../../lib/courses-api'
import { getMostRecentLastVisited, hrefForLastVisited } from '../../lib/last-visited-module-item'
import { hrefForRecommendationItem, surfaceLabel } from '../../lib/recommendation-nav'
import { formatTimeAgoFromIso } from '../../lib/format-time-ago'
import { useInboxUnreadCount } from '../../context/use-inbox-unread'
import { useCourseFeedUnread } from '../../context/use-course-feed-unread'
import { usePermissions } from '../../context/use-permissions'
import {
  computeCourseFinalPercent,
  formatFinalPercent,
  type AssignmentGroupWeight,
  type GradebookColumnForFinal,
} from './gradebook/compute-course-final-percent'
import { DashboardLoadingSkeleton } from '../../components/ui/lms-content-skeletons'
import { LmsPage } from './lms-page'

type CourseEnrollmentRow = {
  userId: string
  displayName: string | null
  role: string
  lastCourseAccessAt?: string | null
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

function weekProgressFraction(now = new Date()): number {
  const start = startOfWeekMonday(now).getTime()
  const end = endOfWeekSunday(startOfWeekMonday(now)).getTime()
  const t = now.getTime()
  if (end <= start) return 0
  return Math.max(0, Math.min(1, (t - start) / (end - start)))
}

function hasStudentRole(roles: readonly string[] | undefined): boolean {
  if (!roles?.length) return false
  return roles.some((r) => r.trim().toLowerCase() === 'student')
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

type AnnouncementPreview = {
  courseCode: string
  courseTitle: string
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
      courseCode: course.courseCode,
      courseTitle: course.title,
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

export default function Dashboard() {
  const { allows, loading: permLoading } = usePermissions()
  const inboxUnread = useInboxUnreadCount()
  const { totalFeedUnread } = useCourseFeedUnread()

  const [catalog, setCatalog] = useState<CoursePublic[] | null>(null)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [courses, setCourses] = useState<CoursePublic[] | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)

  const [studentRows, setStudentRows] = useState<
    {
      course: CoursePublic
      structure: CourseStructureItem[]
      myGrades: CourseMyGradesResponse | null
      announcement: AnnouncementPreview | null
    }[]
  >([])
  const [staffRows, setStaffRows] = useState<
    {
      course: CoursePublic
      emptyGradeCells: number | null
      recentLearners: { name: string; lastAt: string | null }[] | null
    }[]
  >([])

  const [reviewStats, setReviewStats] = useState<ReviewStatsPayload | null>(null)
  const [whatsNextRaw, setWhatsNextRaw] = useState<{
    course: CoursePublic
    primary: RecommendationItem | null
    chips: RecommendationItem[]
    degraded: boolean
  } | null>(null)

  const whatsNext = useMemo(() => {
    const uid = getJwtSubject()
    const top = studentRows[0]?.course
    if (!uid || !top || !whatsNextRaw) return null
    return whatsNextRaw.course.id === top.id ? whatsNextRaw : null
  }, [whatsNextRaw, studentRows])

  const detailGenRef = useRef(0)

  useEffect(() => {
    const uid = getJwtSubject()
    if (!uid) return
    let cancelled = false
    void (async () => {
      try {
        const s = await fetchLearnerReviewStats(uid)
        if (!cancelled) setReviewStats(s)
      } catch {
        if (!cancelled) setReviewStats(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      await Promise.resolve()
      if (cancelled) return
      setCatalogError(null)
      try {
        const res = await authorizedFetch('/api/v1/courses')
        const raw: unknown = await res.json().catch(() => ({}))
        if (!res.ok) {
          if (!cancelled) {
            setCatalog([])
            setCatalogError(readApiErrorMessage(raw))
          }
          return
        }
        const data = raw as { courses?: CoursePublic[] }
        if (!cancelled) setCatalog(data.courses ?? [])
      } catch {
        if (!cancelled) {
          setCatalog([])
          setCatalogError('Could not load courses.')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (catalog === null || permLoading) return
    const gen = ++detailGenRef.current
    const list = catalog

    void (async () => {
      await Promise.resolve()
      if (detailGenRef.current !== gen) return
      setDetailError(null)
      setStudentRows([])
      setStaffRows([])

      if (!list.length) {
        setCourses([])
        return
      }

      try {
        const enriched = await mapPool(list, 4, async (c) => {
          try {
            return await fetchCourse(c.courseCode)
          } catch {
            return c
          }
        })
        if (detailGenRef.current !== gen) return
        setCourses(enriched)

        const studentCourses = enriched.filter((c) => hasStudentRole(c.viewerEnrollmentRoles))
        const staffCourses = enriched.filter((c) => viewerIsCourseStaffEnrollment(c.viewerEnrollmentRoles))

        const sRows = await mapPool(studentCourses, 3, async (course) => {
          let structure: CourseStructureItem[] = []
          let myGrades: CourseMyGradesResponse | null = null
          try {
            structure = await fetchCourseStructure(course.courseCode)
          } catch {
            structure = []
          }
          const preview = getCourseViewAs(course.courseCode)
          if (viewerShouldShowMyGradesNav(course.viewerEnrollmentRoles, preview)) {
            try {
              myGrades = await fetchCourseMyGrades(course.courseCode)
            } catch {
              myGrades = null
            }
          }
          let announcement: AnnouncementPreview | null = null
          if (course.feedEnabled !== false) {
            announcement = await loadAnnouncementPreview(course)
          }
          return { course, structure, myGrades, announcement }
        })

        if (detailGenRef.current !== gen) return

        const tRows = await mapPool(staffCourses, 3, async (course) => {
          const code = course.courseCode
          let emptyGradeCells: number | null = null
          if (allows(courseGradebookViewPermission(code))) {
            try {
              const grid = await fetchCourseGradebookGrid(code)
              emptyGradeCells = countEmptyGradeCells(grid)
            } catch {
              emptyGradeCells = null
            }
          }
          let recentLearners: { name: string; lastAt: string | null }[] | null = null
          if (allows(courseEnrollmentsReadPermission(code))) {
            try {
              const res = await authorizedFetch(`/api/v1/courses/${encodeURIComponent(code)}/enrollments`)
              const raw: unknown = await res.json().catch(() => ({}))
              if (res.ok) {
                const data = raw as { enrollments?: unknown[] }
                const rows = Array.isArray(data.enrollments) ? data.enrollments : []
                const mapped: CourseEnrollmentRow[] = rows.map((row) => {
                  const o = row as Record<string, unknown>
                  const userId =
                    typeof o.userId === 'string'
                      ? o.userId
                      : typeof o.user_id === 'string'
                        ? o.user_id
                        : ''
                  const displayName =
                    typeof o.displayName === 'string'
                      ? o.displayName
                      : typeof o.display_name === 'string'
                        ? o.display_name
                        : null
                  const role = typeof o.role === 'string' ? o.role : 'Student'
                  const lastCourseAccessAt =
                    typeof o.lastCourseAccessAt === 'string'
                      ? o.lastCourseAccessAt
                      : typeof o.last_course_access_at === 'string'
                        ? o.last_course_access_at
                        : null
                  return { userId, displayName, role, lastCourseAccessAt }
                })
                const studentsOnly = mapped.filter((e) => e.role.toLowerCase() === 'student')
                const sorted = [...studentsOnly].sort((a, b) => {
                  const ta = a.lastCourseAccessAt ? new Date(a.lastCourseAccessAt).getTime() : 0
                  const tb = b.lastCourseAccessAt ? new Date(b.lastCourseAccessAt).getTime() : 0
                  return tb - ta
                })
                recentLearners = sorted.slice(0, 5).map((e) => ({
                  name: e.displayName?.trim() || 'Student',
                  lastAt: e.lastCourseAccessAt ?? null,
                }))
              }
            } catch {
              recentLearners = null
            }
          }
          return { course, emptyGradeCells, recentLearners }
        })

        if (detailGenRef.current !== gen) return
        setStudentRows(sRows)
        setStaffRows(tRows)
      } catch {
        if (detailGenRef.current !== gen) return
        setDetailError('Could not load dashboard details.')
        setCourses(list)
      }
    })()
  }, [catalog, permLoading, allows])

  useEffect(() => {
    const uid = getJwtSubject()
    if (!uid || studentRows.length === 0) {
      return
    }
    const { course } = studentRows[0]
    let cancelled = false
    void (async () => {
      try {
        const surfaces = ['continue', 'review', 'strengthen', 'challenge'] as const
        const results = await Promise.all(
          surfaces.map((s) => fetchLearnerRecommendations(uid, course.id, s, { limit: 4 })),
        )
        if (cancelled) return
        const merged: RecommendationItem[] = []
        let degraded = false
        for (const r of results) {
          merged.push(...r.recommendations)
          if (r.degraded) degraded = true
        }
        merged.sort((a, b) => b.score - a.score)
        const primary = merged[0] ?? null
        const chips = merged.slice(1, 4)
        setWhatsNextRaw({ course, primary, chips, degraded })
        if (primary) {
          void postRecommendationEvent({
            courseId: course.id,
            itemId: primary.itemId,
            surface: primary.surface,
            eventType: 'impression',
            rank: 0,
          }).catch(() => {})
        }
      } catch {
        if (!cancelled) setWhatsNextRaw(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [studentRows])

  const weekStart = useMemo(() => startOfWeekMonday(), [])
  const weekEnd = useMemo(() => endOfWeekSunday(weekStart), [weekStart])
  const weekFrac = useMemo(() => weekProgressFraction(), [])

  const courseCodes = useMemo(() => (courses ?? []).map((c) => c.courseCode), [courses])

  /** Read on each render so returning from a module picks up the latest `localStorage` write. */
  const continueTarget =
    courseCodes.length > 0 ? getMostRecentLastVisited(courseCodes) : null

  const announcements = useMemo(() => {
    const list = studentRows.map((r) => r.announcement).filter(Boolean) as AnnouncementPreview[]
    list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    return list.slice(0, 4)
  }, [studentRows])

  const anyStudentExperience = studentRows.length > 0
  const anyStaffExperience = staffRows.length > 0

  const showLoading = catalog === null || courses === null

  return (
    <LmsPage
      title="Dashboard"
      description="Deadlines, grades, and teaching signals across your courses."
    >
      {catalogError && (
        <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-100">
          {catalogError}
        </p>
      )}
      {detailError && (
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
          {detailError}
        </p>
      )}

      {showLoading && !catalogError && <DashboardLoadingSkeleton />}

      {courses && courses.length === 0 && !catalogError && (
        <div className="mt-10 rounded-2xl border border-slate-200 bg-slate-50/80 px-6 py-8 text-center dark:border-neutral-700 dark:bg-neutral-900/50">
          <p className="text-sm font-medium text-slate-800 dark:text-neutral-100">No courses yet</p>
          <p className="mt-2 text-xs text-slate-500 dark:text-neutral-400">
            Join a course from an invite link, or create one if you teach.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <Link
              to="/courses"
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500"
            >
              Browse courses
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        </div>
      )}

      {courses && courses.length > 0 && (
        <div data-onboarding="dashboard-main" className="mt-8 space-y-10">
          <section aria-label="Quick links and unread">
            <div className="flex flex-wrap gap-3">
              <Link
                to="/inbox"
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:border-neutral-600 dark:hover:bg-neutral-800"
              >
                <Inbox className="h-4 w-4 text-indigo-500" aria-hidden />
                Inbox
                {inboxUnread > 0 ? (
                  <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-xs font-semibold text-white">
                    {inboxUnread > 99 ? '99+' : inboxUnread}
                  </span>
                ) : null}
              </Link>
              <Link
                to="/courses"
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:border-neutral-600 dark:hover:bg-neutral-800"
              >
                <BookOpen className="h-4 w-4 text-indigo-500" aria-hidden />
                All courses
              </Link>
              {totalFeedUnread > 0 ? (
                <span className="inline-flex items-center gap-2 rounded-xl border border-teal-200 bg-teal-50 px-4 py-2.5 text-sm font-medium text-teal-900 dark:border-teal-900/50 dark:bg-teal-950/40 dark:text-teal-50">
                  <MessageCircle className="h-4 w-4" aria-hidden />
                  {totalFeedUnread} new feed {totalFeedUnread === 1 ? 'post' : 'posts'} while browsing courses
                </span>
              ) : (
                <span className="inline-flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-4 py-2.5 text-xs text-slate-500 dark:border-neutral-800 dark:bg-neutral-900/40 dark:text-neutral-500">
                  <MessageCircle className="h-4 w-4" aria-hidden />
                  Open a course feed to get live unread counts here.
                </span>
              )}
            </div>
          </section>

          {whatsNext && anyStudentExperience && (
            <section aria-label="Recommended next step">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-neutral-400">
                What&apos;s next
              </h2>
              {whatsNext.primary ? (
                <article
                  role="article"
                  aria-label={`Recommended: ${whatsNext.primary.title} (${surfaceLabel(whatsNext.primary.surface)})`}
                  className="mt-3 rounded-2xl border border-violet-100 bg-gradient-to-br from-violet-50/90 to-white p-5 shadow-sm dark:border-violet-900/40 dark:from-violet-950/30 dark:to-neutral-900"
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-violet-800 dark:text-violet-200">
                    <Sparkles className="h-4 w-4 shrink-0" aria-hidden />
                    <span>{whatsNext.course.title}</span>
                    <span className="rounded-full bg-violet-100 px-2 py-0.5 text-violet-900 dark:bg-violet-900/50 dark:text-violet-100">
                      {surfaceLabel(whatsNext.primary.surface)}
                    </span>
                  </div>
                  <p className="mt-2 text-lg font-semibold tracking-tight text-slate-900 dark:text-neutral-50">
                    {whatsNext.primary.title}
                  </p>
                  <p className="mt-1 text-xs text-slate-600 dark:text-neutral-400">{whatsNext.primary.reason}</p>
                  {whatsNext.degraded ? (
                    <p className="mt-2 text-xs text-amber-800 dark:text-amber-200">
                      Suggestions may be briefly out of date while we refresh them.
                    </p>
                  ) : null}
                  <Link
                    to={hrefForRecommendationItem(whatsNext.course.courseCode, whatsNext.primary)}
                    onClick={() => {
                      const p = whatsNext.primary
                      if (p == null) return
                      void postRecommendationEvent({
                        courseId: whatsNext.course.id,
                        itemId: p.itemId,
                        surface: p.surface,
                        eventType: 'click',
                        rank: 0,
                      }).catch(() => {})
                    }}
                    className="mt-4 inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-500"
                  >
                    Go
                    <ArrowRight className="h-4 w-4" aria-hidden />
                  </Link>
                  {whatsNext.chips.length > 0 ? (
                    <div className="mt-4 flex flex-wrap gap-2 border-t border-violet-100 pt-4 dark:border-violet-900/40">
                      {whatsNext.chips.map((c, idx) => (
                        <Link
                          key={`${c.itemId}-${c.surface}-${idx}`}
                          to={hrefForRecommendationItem(whatsNext.course.courseCode, c)}
                          onClick={() => {
                            void postRecommendationEvent({
                              courseId: whatsNext.course.id,
                              itemId: c.itemId,
                              surface: c.surface,
                              eventType: 'click',
                              rank: idx + 1,
                            }).catch(() => {})
                          }}
                          className="inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-white px-2.5 py-1 text-xs font-medium text-violet-900 shadow-sm hover:bg-violet-50 dark:border-violet-800 dark:bg-neutral-900 dark:text-violet-100 dark:hover:bg-violet-950/40"
                        >
                          <span className="text-violet-600 dark:text-violet-300">{surfaceLabel(c.surface)}</span>
                          <span className="max-w-[10rem] truncate">{c.title}</span>
                        </Link>
                      ))}
                    </div>
                  ) : null}
                </article>
              ) : (
                <p className="mt-3 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4 text-sm text-slate-700 dark:border-neutral-700 dark:bg-neutral-900/50 dark:text-neutral-200">
                  You&apos;re all caught up in {whatsNext.course.title}. Check back after your next activity.
                </p>
              )}
            </section>
          )}

          {reviewStats != null && (
            <section aria-label="Spaced repetition review">
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-amber-100 bg-amber-50/80 px-5 py-4 dark:border-amber-900/40 dark:bg-amber-950/30">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900 dark:text-neutral-100">Review practice</p>
                  <p className="mt-1 text-xs text-slate-600 dark:text-neutral-400">
                    {reviewStats.dueToday > 0
                      ? `${reviewStats.dueToday} item${reviewStats.dueToday === 1 ? '' : 's'} due today`
                      : 'No items due right now'}
                    {reviewStats.streak > 0 ? (
                      <span className="ml-2 inline-flex items-center gap-1 font-medium text-amber-800 dark:text-amber-200">
                        <Flame className="h-3.5 w-3.5" aria-hidden />
                        {reviewStats.streak}-day streak
                      </span>
                    ) : null}
                  </p>
                </div>
                <Link
                  to="/review"
                  className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-500"
                >
                  {reviewStats.dueToday > 0 ? 'Start review' : 'Open review'}
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              </div>
            </section>
          )}

          {continueTarget && (
            <section aria-label="Continue learning">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-neutral-400">
                Continue
              </h2>
              <div className="mt-3 rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/90 to-white p-5 shadow-sm dark:border-indigo-900/40 dark:from-indigo-950/40 dark:to-neutral-900">
                <p className="text-xs font-medium text-indigo-700 dark:text-indigo-200">
                  {courses?.find((c) => c.courseCode === continueTarget.courseCode)?.title ??
                    continueTarget.courseCode}
                </p>
                <p className="mt-1 text-lg font-semibold tracking-tight text-slate-900 dark:text-neutral-50">
                  {continueTarget.title}
                </p>
                <Link
                  to={hrefForLastVisited(continueTarget.courseCode, continueTarget.kind, continueTarget.itemId)}
                  className="mt-4 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500"
                >
                  Continue
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              </div>
            </section>
          )}

          {anyStudentExperience && (
            <section aria-label="Student overview">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-neutral-400">
                Learning
              </h2>

              <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <p className="text-base font-semibold text-slate-900 dark:text-neutral-100">Due this week</p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-neutral-400">
                      {weekStart.toLocaleDateString(undefined, { dateStyle: 'medium' })} –{' '}
                      {weekEnd.toLocaleDateString(undefined, { dateStyle: 'medium' })}
                    </p>
                  </div>
                  <div className="min-w-[140px] flex-1 max-w-xs">
                    <div className="flex justify-between text-[0.65rem] font-medium uppercase tracking-wide text-slate-400 dark:text-neutral-500">
                      <span>Week</span>
                      <span>{Math.round(weekFrac * 100)}%</span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-neutral-800">
                      <div
                        className="h-full rounded-full bg-indigo-500 transition-[width]"
                        style={{ width: `${Math.round(weekFrac * 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
                <ul className="mt-4 space-y-3">
                  {studentRows
                    .flatMap((row) => {
                      const dues = dueThisWeekItems(row.structure, weekStart, weekEnd)
                      return dues.map((it) => ({ row, it }))
                    })
                    .slice(0, 24)
                    .map(({ row, it }) => {
                      const g = gradeSnippetForItem(row.myGrades, it.id)
                      const base = `/courses/${encodeURIComponent(row.course.courseCode)}`
                      const href =
                        it.kind === 'quiz'
                          ? `${base}/modules/quiz/${encodeURIComponent(it.id)}`
                          : it.kind === 'assignment'
                            ? `${base}/modules/assignment/${encodeURIComponent(it.id)}`
                            : `${base}/modules/content/${encodeURIComponent(it.id)}`
                      const dueLabel = new Date(it.dueAt!).toLocaleString(undefined, {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })
                      return (
                        <li key={`${row.course.courseCode}-${it.id}`}>
                          <Link
                            to={href}
                            className="flex flex-col gap-1 rounded-xl border border-slate-100 px-3 py-3 transition hover:border-indigo-200 hover:bg-indigo-50/40 dark:border-neutral-800 dark:hover:border-indigo-900/50 dark:hover:bg-indigo-950/20 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-slate-500 dark:text-neutral-400">
                                {row.course.title}
                              </p>
                              <p className="truncate text-sm font-semibold text-slate-900 dark:text-neutral-100">
                                {it.title}
                              </p>
                              <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500 dark:text-neutral-400">
                                <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden />
                                {dueLabel}
                              </p>
                            </div>
                            {g ? (
                              <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
                                <span className="text-xs font-medium text-slate-600 dark:text-neutral-300">
                                  {g.label}
                                </span>
                                <div className="h-1.5 w-full min-w-[96px] overflow-hidden rounded-full bg-slate-100 dark:bg-neutral-800 sm:w-28">
                                  <div
                                    className="h-full rounded-full bg-emerald-500"
                                    style={{ width: `${Math.round(g.pct)}%` }}
                                  />
                                </div>
                              </div>
                            ) : (
                              <span className="text-xs text-slate-400 dark:text-neutral-500">—</span>
                            )}
                          </Link>
                        </li>
                      )
                    })}
                </ul>
                {studentRows.every((r) => dueThisWeekItems(r.structure, weekStart, weekEnd).length === 0) && (
                  <p className="mt-2 text-sm text-slate-500 dark:text-neutral-400">
                    Nothing due this calendar week.{' '}
                    <Link className="font-medium text-indigo-600 hover:underline dark:text-indigo-400" to="/calendar">
                      Open calendar
                    </Link>{' '}
                    for the full schedule.
                  </p>
                )}
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-2">
                {studentRows.map((row) => {
                  const held = new Set(row.myGrades?.heldGradeItemIds ?? [])
                  const cols: GradebookColumnForFinal[] = (row.myGrades?.columns ?? [])
                    .filter((c) => !held.has(c.id))
                    .map((c) => ({
                      id: c.id,
                      maxPoints: c.maxPoints,
                      assignmentGroupId: c.assignmentGroupId ?? null,
                      neverDrop: c.neverDrop === true,
                      replaceWithFinal: c.replaceWithFinal === true,
                    }))
                  const weights: AssignmentGroupWeight[] = (row.myGrades?.assignmentGroups ?? []).map((g) => ({
                    id: g.id,
                    weightPercent: g.weightPercent,
                    dropLowest: g.dropLowest,
                    dropHighest: g.dropHighest,
                    replaceLowestWithFinal: g.replaceLowestWithFinal,
                  }))
                  const finalPct = computeCourseFinalPercent(cols, row.myGrades?.grades ?? {}, weights)
                  const base = `/courses/${encodeURIComponent(row.course.courseCode)}`
                  return (
                    <div
                      key={row.course.courseCode}
                      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-neutral-700 dark:bg-neutral-900"
                    >
                      <Link
                        to={base}
                        className="text-base font-semibold text-slate-900 hover:text-indigo-600 dark:text-neutral-100 dark:hover:text-indigo-300"
                      >
                        {row.course.title}
                      </Link>
                      <p className="mt-3 text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-neutral-500">
                        Course grade (so far)
                      </p>
                      <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 dark:text-neutral-50">
                        {row.myGrades ? formatFinalPercent(finalPct) : '—'}
                      </p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Link
                          to={`${base}/modules`}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-800"
                        >
                          <ClipboardList className="h-3.5 w-3.5" aria-hidden />
                          Modules
                        </Link>
                        <Link
                          to={`${base}/feed`}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-800"
                        >
                          <MessageCircle className="h-3.5 w-3.5" aria-hidden />
                          Feed
                        </Link>
                        <Link
                          to={`${base}/my-grades`}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-800"
                        >
                          <Sparkles className="h-3.5 w-3.5" aria-hidden />
                          Grades
                        </Link>
                      </div>
                    </div>
                  )
                })}
              </div>

              {announcements.length > 0 && (
                <div className="mt-8">
                  <h3 className="text-sm font-semibold text-slate-800 dark:text-neutral-100">From your courses</h3>
                  <ul className="mt-3 space-y-3">
                    {announcements.map((a) => (
                      <li
                        key={`${a.courseCode}-${a.createdAt}`}
                        className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-neutral-700 dark:bg-neutral-900"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <Megaphone className="h-4 w-4 text-amber-500" aria-hidden />
                          <Link
                            to={`/courses/${encodeURIComponent(a.courseCode)}/feed`}
                            className="text-sm font-semibold text-slate-900 hover:text-indigo-600 dark:text-neutral-100 dark:hover:text-indigo-300"
                          >
                            {a.courseTitle}
                          </Link>
                          {a.pinned ? (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-amber-900 dark:bg-amber-950/60 dark:text-amber-100">
                              Pinned
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-xs text-slate-500 dark:text-neutral-400">
                          {a.channelName} · {a.author} ·{' '}
                          {new Date(a.createdAt).toLocaleString(undefined, {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })}
                        </p>
                        <p className="mt-2 text-sm leading-relaxed text-slate-700 dark:text-neutral-200">
                          {a.snippet}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}

          {anyStaffExperience && (
            <section aria-label="Teaching overview">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-neutral-400">
                Teaching
              </h2>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                {staffRows.map((row) => {
                  const base = `/courses/${encodeURIComponent(row.course.courseCode)}`
                  return (
                    <div
                      key={row.course.courseCode}
                      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-neutral-700 dark:bg-neutral-900"
                    >
                      <Link
                        to={base}
                        className="text-base font-semibold text-slate-900 hover:text-indigo-600 dark:text-neutral-100 dark:hover:text-indigo-300"
                      >
                        {row.course.title}
                      </Link>
                      <dl className="mt-4 space-y-3 text-sm">
                        <div className="flex justify-between gap-3">
                          <dt className="text-slate-500 dark:text-neutral-400">Gradebook gaps</dt>
                          <dd className="font-semibold text-slate-900 dark:text-neutral-100">
                            {row.emptyGradeCells == null ? (
                              <span className="text-slate-400">No access</span>
                            ) : (
                              <>
                                {row.emptyGradeCells}{' '}
                                <span className="font-normal text-slate-500 dark:text-neutral-400">
                                  empty cells
                                </span>
                              </>
                            )}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-3">
                          <dt className="text-slate-500 dark:text-neutral-400">Quizzes in progress</dt>
                          <dd className="text-right text-xs text-slate-500 dark:text-neutral-400">
                            Live attempts appear in the gradebook after students submit or auto-submit. Open the
                            quiz or gradebook to review.
                          </dd>
                        </div>
                      </dl>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Link
                          to={`${base}/gradebook`}
                          className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-500"
                        >
                          Open gradebook
                        </Link>
                        <Link
                          to={`${base}/modules`}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-800"
                        >
                          Modules
                        </Link>
                      </div>
                      {row.recentLearners && row.recentLearners.length > 0 && (
                        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-neutral-800">
                          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">
                            <Users className="h-3.5 w-3.5" aria-hidden />
                            Recent roster activity
                          </p>
                          <ul className="mt-2 space-y-1.5">
                            {row.recentLearners.map((p, i) => (
                              <li
                                key={`${p.name}-${i}`}
                                className="flex justify-between gap-2 text-xs text-slate-600 dark:text-neutral-300"
                              >
                                <span className="truncate font-medium text-slate-800 dark:text-neutral-100">
                                  {p.name}
                                </span>
                                <span className="shrink-0 text-slate-400 dark:text-neutral-500">
                                  {formatTimeAgoFromIso(p.lastAt)}
                                </span>
                              </li>
                            ))}
                          </ul>
                          <Link
                            to={`${base}/enrollments`}
                            className="mt-3 inline-block text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                          >
                            Full roster
                          </Link>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {!anyStudentExperience && !anyStaffExperience && courses.length > 0 && (
            <p className="text-sm text-slate-500 dark:text-neutral-400">
              You have courses open, but no learner or instructor enrollments were returned. Open a course from the
              catalog for full details.
            </p>
          )}
        </div>
      )}
    </LmsPage>
  )
}
