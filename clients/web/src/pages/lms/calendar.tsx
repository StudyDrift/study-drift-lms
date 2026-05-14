import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { authorizedFetch } from '../../lib/api'
import { parseCalendarDateFromQuery } from '../../lib/command-palette-go-to'
import { readApiErrorMessage } from '../../lib/errors'
import {
  fetchCourseStructure,
  type CoursePublic,
  type CourseStructureItem,
} from '../../lib/courses-api'
import { CourseCalendar, type CourseCalendarAssignment } from './course-calendar'
import { LmsPage } from './lms-page'

const LS_DISABLED_KEY = 'lextures.globalCalendar.disabledCourseIds'

function readDisabledCourseIdsFromStorage(): string[] | null {
  try {
    const raw = window.localStorage.getItem(LS_DISABLED_KEY)
    if (raw == null) return null
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    return parsed.filter((x): x is string => typeof x === 'string')
  } catch {
    return null
  }
}

function writeDisabledCourseIdsToStorage(ids: string[]) {
  try {
    window.localStorage.setItem(LS_DISABLED_KEY, JSON.stringify(ids))
  } catch {
    /* ignore quota / private mode */
  }
}

function mergeDisabledIds(eligible: CoursePublic[], stored: string[] | null): Set<string> {
  const eligibleIds = new Set(eligible.map((c) => c.id))
  if (stored === null) {
    return new Set()
  }
  const out = new Set<string>()
  for (const id of stored) {
    if (eligibleIds.has(id)) out.add(id)
  }
  return out
}

function structureToAssignments(
  course: CoursePublic,
  items: CourseStructureItem[],
  paletteIndex: number,
): CourseCalendarAssignment[] {
  const isDueCalendarItem = (
    i: CourseStructureItem,
  ): i is CourseStructureItem & {
    kind: 'content_page' | 'assignment' | 'quiz'
    dueAt: string
  } =>
    (i.kind === 'content_page' || i.kind === 'assignment' || i.kind === 'quiz') && Boolean(i.dueAt)

  const title = course.title.trim() || course.courseCode
  return items.filter(isDueCalendarItem).map((i) => ({
    id: i.id,
    title: i.title,
    dueAt: i.dueAt,
    kind: i.kind,
    pointsWorth: i.pointsWorth,
    pointsPossible: i.pointsPossible,
    isAdaptive: i.isAdaptive,
    linkCourseCode: course.courseCode,
    courseTitle: title,
    courseLabel: course.courseCode,
    paletteIndex,
  }))
}

export default function Calendar() {
  const [searchParams] = useSearchParams()
  const rawDate = searchParams.get('date')?.trim() ?? ''
  const dateKey = useMemo(() => parseCalendarDateFromQuery(rawDate), [rawDate])

  const [courses, setCourses] = useState<CoursePublic[] | null>(null)
  const [coursesError, setCoursesError] = useState<string | null>(null)
  const [disabledCourseIds, setDisabledCourseIds] = useState<Set<string>>(() => new Set())

  const [structureByCourseId, setStructureByCourseId] = useState<
    Record<string, CourseStructureItem[] | null>
  >({})
  const [structureErrors, setStructureErrors] = useState<Record<string, string>>({})
  const [structuresLoading, setStructuresLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setCoursesError(null)
      try {
        const res = await authorizedFetch('/api/v1/courses')
        const raw: unknown = await res.json().catch(() => ({}))
        if (!res.ok) {
          if (!cancelled) {
            setCourses([])
            setCoursesError(readApiErrorMessage(raw))
            setDisabledCourseIds(new Set())
          }
          return
        }
        const data = raw as { courses?: CoursePublic[] }
        const list = data.courses ?? []
        if (!cancelled) {
          setCourses(list)
          const eligible = list.filter((c) => !c.archived && c.calendarEnabled !== false)
          setDisabledCourseIds(mergeDisabledIds(eligible, readDisabledCourseIdsFromStorage()))
        }
      } catch {
        if (!cancelled) {
          setCourses([])
          setCoursesError('Could not load courses.')
          setDisabledCourseIds(new Set())
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const eligibleCourses = useMemo(
    () => (courses ?? []).filter((c) => !c.archived && c.calendarEnabled !== false),
    [courses],
  )

  const enabledCourses = useMemo(
    () => eligibleCourses.filter((c) => !disabledCourseIds.has(c.id)),
    [eligibleCourses, disabledCourseIds],
  )

  const paletteIndexByCourseId = useMemo(() => {
    const m = new Map<string, number>()
    eligibleCourses.forEach((c, i) => m.set(c.id, i))
    return m
  }, [eligibleCourses])

  useEffect(() => {
    let cancelled = false
    const targets = enabledCourses

    if (targets.length === 0) {
      setStructuresLoading(false)
      setStructureByCourseId({})
      setStructureErrors({})
      return
    }

    setStructuresLoading(true)
    setStructureErrors({})

    ;(async () => {
      const next: Record<string, CourseStructureItem[] | null> = {}
      const errs: Record<string, string> = {}

      await Promise.all(
        targets.map(async (c) => {
          try {
            const items = await fetchCourseStructure(c.courseCode)
            if (!cancelled) next[c.id] = items
          } catch (e) {
            if (!cancelled) {
              next[c.id] = null
              errs[c.id] = e instanceof Error ? e.message : 'Could not load calendar.'
            }
          }
        }),
      )

      if (cancelled) return
      setStructureByCourseId(next)
      setStructureErrors(errs)
      setStructuresLoading(false)
    })()

    return () => {
      cancelled = true
    }
  }, [enabledCourses])

  const mergedAssignments: CourseCalendarAssignment[] = useMemo(() => {
    const out: CourseCalendarAssignment[] = []
    for (const c of enabledCourses) {
      const items = structureByCourseId[c.id]
      if (!items) continue
      const pi = paletteIndexByCourseId.get(c.id) ?? 0
      out.push(...structureToAssignments(c, items, pi))
    }
    return out
  }, [enabledCourses, structureByCourseId, paletteIndexByCourseId])

  const hasAnyLoadedStructure = useMemo(
    () => enabledCourses.some((c) => Array.isArray(structureByCourseId[c.id])),
    [enabledCourses, structureByCourseId],
  )

  const setCourseEnabled = useCallback((courseId: string, enabled: boolean) => {
    setDisabledCourseIds((prev) => {
      const next = new Set(prev)
      if (enabled) next.delete(courseId)
      else next.add(courseId)
      writeDisabledCourseIdsToStorage([...next])
      return next
    })
  }, [])

  const showAllCourses = useCallback(() => {
    setDisabledCourseIds(() => {
      writeDisabledCourseIdsToStorage([])
      return new Set()
    })
  }, [])

  const hideAllCourses = useCallback(() => {
    setDisabledCourseIds(() => {
      const all = eligibleCourses.map((c) => c.id)
      writeDisabledCourseIdsToStorage(all)
      return new Set(all)
    })
  }, [eligibleCourses])

  const representativeCourseCode = enabledCourses[0]?.courseCode ?? ''

  return (
    <LmsPage
      title="Calendar"
      description="Month, week, and to-do views across your courses. Toggle courses on the left to show or hide their due dates."
      fillHeight
    >
      {coursesError && (
        <p className="mt-6 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-200">
          {coursesError}
        </p>
      )}
      {courses === null && !coursesError && (
        <p className="mt-8 text-sm text-slate-500 dark:text-neutral-400">Loading…</p>
      )}
      {courses && courses.length === 0 && !coursesError && (
        <p className="mt-8 text-sm text-slate-600 dark:text-neutral-300">No courses on your account yet.</p>
      )}
      {courses && courses.length > 0 && eligibleCourses.length === 0 && !coursesError && (
        <p className="mt-8 text-sm text-slate-600 dark:text-neutral-300">
          No enrolled courses have the calendar tool enabled.
        </p>
      )}
      {eligibleCourses.length > 0 ? (
        <div className="mt-4 flex min-h-0 flex-1 flex-col gap-5 lg:mt-6 lg:flex-row lg:gap-6">
          <aside className="shrink-0 lg:sticky lg:top-4 lg:max-h-[min(28rem,calc(100vh-8rem))] lg:w-72 lg:self-start">
            <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm dark:border-neutral-700 dark:bg-neutral-900/90">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold tracking-tight text-slate-900 dark:text-neutral-100">
                    Courses
                  </h2>
                  <p className="mt-1 text-xs text-slate-500 dark:text-neutral-400">
                    Show due dates from selected courses on the calendar.
                  </p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={showAllCourses}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:bg-white dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
                >
                  Show all
                </button>
                <button
                  type="button"
                  onClick={hideAllCourses}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:bg-white dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
                >
                  Hide all
                </button>
              </div>
              <ul className="mt-4 max-h-64 space-y-2 overflow-y-auto overscroll-contain pr-0.5 lg:max-h-[min(22rem,calc(100vh-12rem))]">
                {eligibleCourses.map((c) => {
                  const enabled = !disabledCourseIds.has(c.id)
                  const label = c.title.trim() || c.courseCode
                  const err = structureErrors[c.id]
                  return (
                    <li key={c.id}>
                      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-transparent px-2 py-2 transition hover:border-slate-200 hover:bg-slate-50/80 dark:hover:border-neutral-600 dark:hover:bg-neutral-800/60">
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-neutral-600 dark:bg-neutral-900 dark:text-indigo-500 dark:focus:ring-indigo-400"
                          checked={enabled}
                          onChange={(e) => setCourseEnabled(c.id, e.target.checked)}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-slate-900 dark:text-neutral-100">
                            {label}
                          </span>
                          <span className="mt-0.5 block text-xs text-slate-500 dark:text-neutral-400">
                            {c.courseCode}
                          </span>
                          {enabled && err ? (
                            <span className="mt-1 block text-xs text-rose-600 dark:text-rose-400">{err}</span>
                          ) : null}
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            </div>
          </aside>
          <div className="flex min-h-[28rem] min-w-0 flex-1 flex-col lg:min-h-0">
            {enabledCourses.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-8 text-center text-sm text-slate-600 dark:border-neutral-700 dark:bg-neutral-950/40 dark:text-neutral-300">
                Turn on at least one course to load its schedule.
              </p>
            ) : structuresLoading && !hasAnyLoadedStructure ? (
              <p className="text-sm text-slate-500 dark:text-neutral-400">Loading calendars…</p>
            ) : (
              <CourseCalendar
                courseCode={representativeCourseCode}
                assignments={mergedAssignments}
                canRescheduleDueByDrag={false}
                initialDateKey={dateKey}
              />
            )}
          </div>
        </div>
      ) : null}
    </LmsPage>
  )
}
