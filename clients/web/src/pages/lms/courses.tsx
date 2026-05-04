import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject } from 'react'
import { Link } from 'react-router-dom'
import {
  closestCorners,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { BookOpen, Plus } from 'lucide-react'
import { EmptyState } from '../../components/ui/empty-state'
import { CoursesCatalogSkeleton } from '../../components/ui/lms-content-skeletons'
import { LmsPage } from './lms-page'
import { RequirePermission } from '../../components/require-permission'
import { usePermissions } from '../../context/use-permissions'
import { authorizedFetch } from '../../lib/api'
import { putCourseCatalogOrder, type CoursePublic, fetchOrgTerms, type OrgTerm } from '../../lib/courses-api'
import { decodeJwtPayload } from '../../lib/jwt-payload'
import { getAccessToken } from '../../lib/auth'
import { readApiErrorMessage } from '../../lib/errors'
import { heroImageObjectStyle } from '../../lib/hero-image-position'
import { formatRelativeCompact } from '../../lib/format-datetime'
import { CourseCatalogStatusPill } from '../../components/ui/status-vocabulary'
import { PERM_COURSE_CREATE } from '../../lib/rbac-api'

export type { CoursePublic } from '../../lib/courses-api'

const COURSE_GRID_SORT_ID = 'course-catalog-grid'

function formatEditedAgo(iso: string): string {
  return `Edited ${formatRelativeCompact(iso)}`
}

/** Catalog pill: draft vs published schedule window (uses real `published`, `startsAt`, `endsAt`). */
function courseStatusBadgeLabel(c: CoursePublic): string {
  if (!c.published) return 'Draft'
  const now = Date.now()
  if (c.endsAt) {
    const end = new Date(c.endsAt).getTime()
    if (!Number.isNaN(end) && end < now) return 'Ended'
  }
  if (c.startsAt) {
    const start = new Date(c.startsAt).getTime()
    if (!Number.isNaN(start) && start > now) return 'Upcoming'
  }
  return 'Active'
}

function CourseCard({
  course,
  sortable,
  suppressNavigateAfterDragRef,
}: {
  course: CoursePublic
  suppressNavigateAfterDragRef?: MutableRefObject<boolean>
  sortable?: {
    listeners: Record<string, unknown>
    setNodeRef: (node: HTMLElement | null) => void
    style: CSSProperties
    isDragging: boolean
  }
}) {
  const courseHref = `/courses/${encodeURIComponent(course.courseCode)}`
  const badgeLabel = courseStatusBadgeLabel(course)
  const descriptionBlurb = course.description.trim() || 'No description yet.'

  return (
    <article
      ref={sortable?.setNodeRef}
      style={sortable?.style}
      className={[
        'flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-900/5 transition-shadow',
        sortable ? 'touch-none cursor-grab active:cursor-grabbing' : '',
        sortable?.isDragging ? 'shadow-md shadow-slate-900/10 ring-2 ring-indigo-400/40' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      {...(sortable ? sortable.listeners : {})}
    >
      <Link
        to={courseHref}
        className="relative block focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
        aria-label={`Open ${course.title}`}
        onClick={(e) => {
          if (!suppressNavigateAfterDragRef?.current) return
          e.preventDefault()
          e.stopPropagation()
          suppressNavigateAfterDragRef.current = false
        }}
      >
        <img
          data-lex-hero
          src={course.heroImageUrl ?? '/course-card-hero.png'}
          alt=""
          draggable={false}
          loading="lazy"
          decoding="async"
          className="h-40 w-full object-cover"
          style={heroImageObjectStyle(course.heroImageObjectPosition)}
        />
        <div
          className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-transparent"
          aria-hidden
        />
        <span className="absolute left-3 top-3">
          <CourseCatalogStatusPill label={badgeLabel} />
        </span>
        <div className="absolute inset-x-0 bottom-0 p-4 pt-10">
          <h2 className="text-lg font-semibold leading-snug tracking-tight text-white drop-shadow-sm line-clamp-2">
            {course.title}
          </h2>
        </div>
      </Link>

      <div className="flex flex-1 flex-col justify-end px-5 pb-4 pt-3">
        <p className="text-left text-sm leading-snug text-slate-600 line-clamp-4">{descriptionBlurb}</p>
        <p className="mt-3 text-left text-xs text-slate-400">{formatEditedAgo(course.updatedAt)}</p>
      </div>
    </article>
  )
}

function SortableCourseCard({
  course,
  suppressNavigateAfterDragRef,
}: {
  course: CoursePublic
  suppressNavigateAfterDragRef: MutableRefObject<boolean>
}) {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: course.id,
  })
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.92 : undefined,
    zIndex: isDragging ? 20 : undefined,
  }

  return (
    <div className="h-full min-h-0">
      <CourseCard
        course={course}
        suppressNavigateAfterDragRef={suppressNavigateAfterDragRef}
        sortable={{
          listeners: listeners as Record<string, unknown>,
          setNodeRef,
          style,
          isDragging,
        }}
      />
    </div>
  )
}

export default function Courses() {
  const { allows, loading: permLoading } = usePermissions()
  const [courses, setCourses] = useState<CoursePublic[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [termFilter, setTermFilter] = useState<string>('')
  const [termList, setTermList] = useState<OrgTerm[]>([])
  const orgId = decodeJwtPayload(getAccessToken())?.org_id ?? ''

  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    void fetchOrgTerms(orgId)
      .then((t) => {
        if (!cancelled) setTermList(t)
      })
      .catch(() => {
        if (!cancelled) setTermList([])
      })
    return () => {
      cancelled = true
    }
  }, [orgId])
  /** After a catalog drag, the browser may emit a click on the card link; block that navigation. */
  const suppressNavigateAfterDragRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setError(null)
      try {
        const qs = termFilter && termFilter !== ''
          ? `?term_id=${encodeURIComponent(termFilter)}`
          : ''
        const res = await authorizedFetch(`/api/v1/courses${qs}`)
        const raw: unknown = await res.json().catch(() => ({}))
        if (!res.ok) {
          setCourses([])
          setError(readApiErrorMessage(raw))
          return
        }
        const data = raw as { courses?: CoursePublic[] }
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
  }, [termFilter])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const courseIds = useMemo(() => (courses ?? []).map((c) => c.id), [courses])

  const catalogSections = useMemo(() => {
    if (!courses?.length || termFilter !== '') return null
    if (!courses.some((c) => c.termId)) return null
    const ongoing = courses.filter((c) => !c.termId)
    const termOrder = [...termList].sort((a, b) => (a.startDate < b.startDate ? 1 : -1))
    const sections: { key: string; title: string; items: CoursePublic[] }[] = []
    if (ongoing.length > 0) {
      sections.push({ key: 'ongoing', title: 'Ongoing / Self-paced', items: ongoing })
    }
    const seen = new Set<string>()
    for (const t of termOrder) {
      const items = courses.filter((c) => c.termId === t.id)
      if (items.length === 0) continue
      sections.push({ key: t.id, title: t.name, items })
      seen.add(t.id)
    }
    const orphan = courses.filter((c) => c.termId && !seen.has(c.termId))
    if (orphan.length > 0) {
      const byId = new Map<string, CoursePublic[]>()
      for (const c of orphan) {
        const id = c.termId!
        byId.set(id, [...(byId.get(id) ?? []), c])
      }
      for (const [id, items] of byId) {
        const label = items[0]?.term?.name ?? 'Term'
        sections.push({ key: id, title: label, items })
      }
    }
    return sections
  }, [courses, termFilter, termList])

  const clearSuppressNavigateAfterDragSoon = useCallback(() => {
    window.setTimeout(() => {
      suppressNavigateAfterDragRef.current = false
    }, 200)
  }, [])

  const handleDragStart = useCallback(() => {
    suppressNavigateAfterDragRef.current = true
  }, [])

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      clearSuppressNavigateAfterDragSoon()
      if (!over || active.id === over.id || !courses?.length) return
      setError(null)
      const oldIndex = courses.findIndex((c) => c.id === active.id)
      const newIndex = courses.findIndex((c) => c.id === over.id)
      if (oldIndex < 0 || newIndex < 0) return
      const previous = courses
      const next = arrayMove(previous, oldIndex, newIndex)
      setCourses(next)
      void putCourseCatalogOrder(next.map((c) => c.id)).catch(() => {
        setCourses(previous)
        setError('Could not save course order. Try again.')
      })
    },
    [courses, clearSuppressNavigateAfterDragSoon],
  )

  const handleDragCancel = useCallback(() => {
    clearSuppressNavigateAfterDragSoon()
  }, [clearSuppressNavigateAfterDragSoon])

  return (
    <LmsPage
      title="Courses"
      description="Browse and open your enrolled courses. Drag a card to reorder your catalog."
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

      {orgId && termList.length > 0 && (
        <div className="mt-6 max-w-md">
          <label htmlFor="course-catalog-term-filter" className="text-sm font-medium text-slate-700 dark:text-neutral-200">
            Term
          </label>
          <select
            id="course-catalog-term-filter"
            value={termFilter}
            onChange={(e) => setTermFilter(e.target.value)}
            className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/30 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
            aria-label="Filter courses by academic term"
          >
            <option value="">All courses</option>
            {termList.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {courses === null && !error && <CoursesCatalogSkeleton />}

      {courses && courses.length === 0 && !error && (
        <div className="mt-8">
          {!permLoading && allows(PERM_COURSE_CREATE) ? (
            <EmptyState
              icon={BookOpen}
              title="Create your first course"
              body="You do not have any courses in your catalog yet. Add a title and description to get started, then invite learners from the course dashboard."
              primaryAction={{ label: 'New course', to: '/courses/create' }}
            />
          ) : (
            <EmptyState
              icon={BookOpen}
              title="No courses yet"
              body="You are not enrolled in any published courses. When an instructor adds you, the course will appear here."
            />
          )}
        </div>
      )}

      {courses && courses.length > 0 && catalogSections && (
        <DndContext
          id={COURSE_GRID_SORT_ID}
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <SortableContext items={courseIds} strategy={rectSortingStrategy}>
            <div className="mt-8 space-y-10">
              {catalogSections.map((sec) => (
                <section key={sec.key} aria-labelledby={`cat-${sec.key}`}>
                  <h2
                    id={`cat-${sec.key}`}
                    className="text-base font-semibold text-slate-900 dark:text-neutral-100"
                  >
                    {sec.title}
                  </h2>
                  <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {sec.items.map((c) => (
                      <SortableCourseCard
                        key={c.id}
                        course={c}
                        suppressNavigateAfterDragRef={suppressNavigateAfterDragRef}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {courses && courses.length > 0 && !catalogSections && (
        <DndContext
          id={COURSE_GRID_SORT_ID}
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <SortableContext items={courseIds} strategy={rectSortingStrategy}>
            <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {courses.map((c) => (
                <SortableCourseCard
                  key={c.id}
                  course={c}
                  suppressNavigateAfterDragRef={suppressNavigateAfterDragRef}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </LmsPage>
  )
}
