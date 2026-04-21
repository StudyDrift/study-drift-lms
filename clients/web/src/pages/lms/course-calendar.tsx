import { createPortal } from 'react-dom'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, ChevronLeft, ChevronRight, LayoutList, ListTodo } from 'lucide-react'
import {
  addMonths,
  dateKeyLocal,
  endOfWeekMondayExclusive,
  formatDueShort,
  isInTodoWindow,
  mergeLocalCalendarDayPreserveWallClock,
  monthGridCells,
  startOfMonth,
  startOfWeekMonday,
} from '../../lib/course-calendar-utils'
import { patchCourseStructureItemDueAt } from '../../lib/courses-api'

export type CourseCalendarAssignment = {
  id: string
  title: string
  dueAt: string
  /** Drives the correct module URL (`content`, `assignment`, or `quiz`). */
  kind: 'content_page' | 'assignment' | 'quiz'
  /** Shown in the calendar hover card when present. */
  pointsWorth?: number | null
  /** Quizzes: summed question points when not adaptive. */
  pointsPossible?: number | null
  isAdaptive?: boolean
}

type ViewId = 'month' | 'week' | 'todo'

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function calendarItemKindLabel(kind: CourseCalendarAssignment['kind']): string {
  switch (kind) {
    case 'assignment':
      return 'Assignment'
    case 'quiz':
      return 'Quiz'
    case 'content_page':
      return 'Content page'
  }
}

function calendarItemPointsSummary(a: CourseCalendarAssignment): string | null {
  if (a.kind === 'assignment' && a.pointsWorth != null) {
    return `${a.pointsWorth} point${a.pointsWorth === 1 ? '' : 's'}`
  }
  if (a.kind === 'quiz') {
    if (a.isAdaptive) return 'Adaptive quiz'
    if (a.pointsPossible != null) {
      return `Up to ${a.pointsPossible} point${a.pointsPossible === 1 ? '' : 's'}`
    }
    if (a.pointsWorth != null) return `${a.pointsWorth} point${a.pointsWorth === 1 ? '' : 's'}`
  }
  return null
}

type CalendarAssignmentHoverOpen = {
  assignment: CourseCalendarAssignment
  anchor: HTMLElement
}

function AssignmentHoverPortal({ open }: { open: CalendarAssignmentHoverOpen | null }) {
  const popRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)

  useLayoutEffect(() => {
    if (!open) {
      return
    }
    const { anchor } = open
    const measure = () => {
      const r = anchor.getBoundingClientRect()
      const el = popRef.current
      const margin = 8
      const width = Math.min(320, window.innerWidth - 2 * margin)
      const left = Math.max(margin, Math.min(r.left, window.innerWidth - width - margin))
      const popH = el?.offsetHeight ?? 168
      let top = r.bottom + margin
      if (top + popH > window.innerHeight - margin) {
        top = r.top - popH - margin
      }
      top = Math.max(margin, top)
      setPos({ top, left, width })
    }
    measure()
    const raf = window.requestAnimationFrame(measure)
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    return () => {
      window.cancelAnimationFrame(raf)
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
    }
  }, [open])

  if (!open) return null

  const a = open.assignment
  const points = calendarItemPointsSummary(a)

  return createPortal(
    <div
      ref={popRef}
      role="tooltip"
      className="pointer-events-none max-h-[min(22rem,calc(100vh-1rem))] overflow-y-auto rounded-xl border border-slate-200/90 bg-white px-3 py-2.5 text-left text-sm shadow-lg dark:border-neutral-600 dark:bg-neutral-800 dark:shadow-black/40"
      style={
        pos
          ? { position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 80 }
          : { position: 'fixed', top: -4000, left: 0, width: 320, zIndex: 80, opacity: 0 }
      }
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-neutral-400">
        {calendarItemKindLabel(a.kind)}
      </p>
      <p className="mt-1 font-semibold tracking-tight text-slate-950 dark:text-neutral-100">
        {a.title || 'Untitled'}
      </p>
      <p className="mt-2 text-xs text-slate-600 dark:text-neutral-300">
        <span className="font-medium text-slate-500 dark:text-neutral-400">Due </span>
        {formatDueShort(a.dueAt)}
      </p>
      {points ? <p className="mt-1.5 text-xs text-slate-600 dark:text-neutral-300">{points}</p> : null}
    </div>,
    document.body,
  )
}

const CAL_DAY_ID = 'cal-day:'
const CAL_ASSIGNMENT_ID = 'cal-assignment:'

type CalendarMonthDraggableDueLinkProps = {
  a: CourseCalendarAssignment
  to: string
  canDrag: boolean
  onShowAssignmentHover: (a: CourseCalendarAssignment, el: HTMLElement) => void
  onHideAssignmentHover: () => void
}

function CalendarMonthDraggableDueLink({
  a,
  to,
  canDrag,
  onShowAssignmentHover,
  onHideAssignmentHover,
}: CalendarMonthDraggableDueLinkProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `${CAL_ASSIGNMENT_ID}${a.id}`,
    disabled: !canDrag,
  })
  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined
  return (
    <li className="min-w-0">
      <Link
        ref={setNodeRef}
        style={style}
        {...(canDrag ? { ...listeners, ...attributes } : {})}
        to={to}
        aria-label={`${calendarItemKindLabel(a.kind)}: ${a.title || 'Untitled'}. Due ${formatDueShort(a.dueAt)}.`}
        onMouseEnter={(e) => onShowAssignmentHover(a, e.currentTarget)}
        onMouseLeave={onHideAssignmentHover}
        onFocus={(e) => onShowAssignmentHover(a, e.currentTarget)}
        onBlur={onHideAssignmentHover}
        className={`block w-full truncate rounded-md bg-indigo-50/90 px-1 py-0.5 text-left text-[11px] font-semibold leading-tight text-indigo-900 transition hover:bg-indigo-100 hover:ring-1 hover:ring-indigo-200/80 dark:bg-indigo-950/50 dark:text-indigo-100 dark:hover:bg-indigo-900/60 dark:hover:ring-indigo-500/40 ${
          canDrag ? 'cursor-grab touch-manipulation active:cursor-grabbing' : ''
        } ${isDragging ? 'opacity-40' : ''}`}
      >
        {a.title || 'Untitled'}
      </Link>
    </li>
  )
}

type CalendarMonthDayCellProps = {
  cell: Date
  monthAnchor: Date
  now: Date
  dayItems: CourseCalendarAssignment[]
  canDragReschedule: boolean
  itemPath: (a: CourseCalendarAssignment) => string
  onShowAssignmentHover: (a: CourseCalendarAssignment, el: HTMLElement) => void
  onHideAssignmentHover: () => void
  focusDateKey?: string | null
}

function CalendarMonthDayCell({
  cell,
  monthAnchor,
  now,
  dayItems,
  canDragReschedule,
  itemPath,
  onShowAssignmentHover,
  onHideAssignmentHover,
  focusDateKey = null,
}: CalendarMonthDayCellProps) {
  const inMonth = cell.getMonth() === monthAnchor.getMonth()
  const key = dateKeyLocal(cell)
  const isToday = key === dateKeyLocal(now)
  const isFocusDay = Boolean(focusDateKey && focusDateKey === key)
  const { setNodeRef, isOver } = useDroppable({
    id: `${CAL_DAY_ID}${key}`,
    disabled: !canDragReschedule,
  })
  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-[5rem] flex-col bg-white p-1.5 text-left dark:bg-neutral-900/95 ${
        inMonth ? '' : 'bg-slate-50/90 text-slate-400 dark:bg-neutral-950/80 dark:text-neutral-500'
      } ${canDragReschedule && isOver ? 'ring-2 ring-inset ring-indigo-400/70 dark:ring-indigo-400/50' : ''} ${
        isFocusDay && !isOver ? 'ring-2 ring-inset ring-amber-400/80 dark:ring-amber-500/50' : ''
      }`}
    >
      <div className="flex shrink-0 items-start">
        <span
          className={`inline-flex h-7 min-w-[1.75rem] items-center justify-center rounded-lg text-sm font-medium ${
            isToday
              ? 'bg-indigo-600 text-white shadow-sm dark:bg-indigo-500 dark:text-white'
              : isFocusDay
                ? 'bg-amber-100 text-amber-950 ring-1 ring-amber-300/80 dark:bg-amber-950/60 dark:text-amber-50 dark:ring-amber-600/60'
                : inMonth
                  ? 'text-slate-800 dark:text-neutral-200'
                  : 'text-slate-400 dark:text-neutral-500'
          }`}
        >
          {cell.getDate()}
        </span>
      </div>
      {dayItems.length > 0 ? (
        <ul className="mt-1 min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain">
          {dayItems.map((a) => (
            <CalendarMonthDraggableDueLink
              key={a.id}
              a={a}
              to={itemPath(a)}
              canDrag={canDragReschedule}
              onShowAssignmentHover={onShowAssignmentHover}
              onHideAssignmentHover={onHideAssignmentHover}
            />
          ))}
        </ul>
      ) : null}
    </div>
  )
}

type CourseCalendarProps = {
  courseCode: string
  assignments: CourseCalendarAssignment[]
  /** Drag due items between days; requires `course:<courseCode>:items:create` (server-enforced). */
  canRescheduleDueByDrag?: boolean
  onDueDatesChanged?: () => void | Promise<void>
  /** `YYYY-MM-DD` — opens month view containing this day (from URL `?date=`). */
  initialDateKey?: string | null
}

export function CourseCalendar({
  courseCode,
  assignments,
  canRescheduleDueByDrag = false,
  onDueDatesChanged,
  initialDateKey = null,
}: CourseCalendarProps) {
  const [view, setView] = useState<ViewId>('month')
  const [monthAnchor, setMonthAnchor] = useState(() => startOfMonth(new Date()))
  const [weekCursor, setWeekCursor] = useState(() => new Date())
  const [assignmentHover, setAssignmentHover] = useState<CalendarAssignmentHoverOpen | null>(null)
  const [activeDragAssignment, setActiveDragAssignment] = useState<CourseCalendarAssignment | null>(null)
  const [rescheduleError, setRescheduleError] = useState<string | null>(null)
  const [rescheduleBusy, setRescheduleBusy] = useState(false)

  useEffect(() => {
    if (!initialDateKey || !/^\d{4}-\d{2}-\d{2}$/.test(initialDateKey)) return
    const [y, m, d] = initialDateKey.split('-').map((x) => Number.parseInt(x, 10))
    const parsed = new Date(y, m - 1, d)
    if (Number.isNaN(parsed.getTime())) return
    setMonthAnchor(startOfMonth(parsed))
    setWeekCursor(parsed)
  }, [initialDateKey])

  const dragSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 10 } }),
  )

  const showAssignmentHover = useCallback((a: CourseCalendarAssignment, anchor: HTMLElement) => {
    setAssignmentHover({ assignment: a, anchor })
  }, [])

  const hideAssignmentHover = useCallback(() => {
    setAssignmentHover(null)
  }, [])

  useEffect(() => {
    if (!assignmentHover) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAssignmentHover(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [assignmentHover])

  useEffect(() => {
    setAssignmentHover(null)
  }, [view, monthAnchor])

  useEffect(() => {
    setRescheduleError(null)
  }, [view, monthAnchor, courseCode])

  const onDragStart = useCallback(
    (event: DragStartEvent) => {
      if (!canRescheduleDueByDrag) return
      setRescheduleError(null)
      const id = String(event.active.id)
      if (!id.startsWith(CAL_ASSIGNMENT_ID)) return
      const raw = id.slice(CAL_ASSIGNMENT_ID.length)
      const hit = assignments.find((x) => x.id === raw)
      setActiveDragAssignment(hit ?? null)
    },
    [assignments, canRescheduleDueByDrag],
  )

  const onDragCancel = useCallback(() => {
    setActiveDragAssignment(null)
  }, [])

  const sorted = useMemo(
    () => [...assignments].sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()),
    [assignments],
  )

  const now = new Date()

  const monthCells = useMemo(() => monthGridCells(monthAnchor), [monthAnchor])

  const onDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setActiveDragAssignment(null)
      if (!canRescheduleDueByDrag) return
      const { active, over } = event
      if (!over) return
      const aid = String(active.id)
      if (!aid.startsWith(CAL_ASSIGNMENT_ID)) return
      const overId = String(over.id)
      if (!overId.startsWith(CAL_DAY_ID)) return
      const itemId = aid.slice(CAL_ASSIGNMENT_ID.length)
      const dayKey = overId.slice(CAL_DAY_ID.length)
      const assignment = assignments.find((x) => x.id === itemId)
      if (!assignment) return
      if (dateKeyLocal(new Date(assignment.dueAt)) === dayKey) return

      const cells = monthGridCells(monthAnchor)
      const cell = cells.find((c) => dateKeyLocal(c) === dayKey)
      if (!cell) return

      const nextIso = mergeLocalCalendarDayPreserveWallClock(cell, assignment.dueAt)
      setRescheduleBusy(true)
      setRescheduleError(null)
      try {
        await patchCourseStructureItemDueAt(courseCode, itemId, { dueAt: nextIso })
        await onDueDatesChanged?.()
      } catch (e) {
        setRescheduleError(e instanceof Error ? e.message : 'Could not update due date.')
      } finally {
        setRescheduleBusy(false)
      }
    },
    [assignments, canRescheduleDueByDrag, courseCode, monthAnchor, onDueDatesChanged],
  )

  const itemsByDay = useMemo(() => {
    const m = new Map<string, CourseCalendarAssignment[]>()
    for (const a of sorted) {
      const key = dateKeyLocal(new Date(a.dueAt))
      const list = m.get(key)
      if (list) list.push(a)
      else m.set(key, [a])
    }
    return m
  }, [sorted])

  const { weekStart, weekEnd, weekItems } = useMemo(() => {
    const ws = startOfWeekMonday(weekCursor)
    const we = endOfWeekMondayExclusive(weekCursor)
    const items = sorted.filter((a) => {
      const t = new Date(a.dueAt).getTime()
      return t >= ws.getTime() && t < we.getTime()
    })
    return { weekStart: ws, weekEnd: we, weekItems: items }
  }, [sorted, weekCursor])

  const todoItems = useMemo(() => {
    const t = new Date()
    return sorted.filter((a) => isInTodoWindow(new Date(a.dueAt), t))
  }, [sorted])

  const modulesBase = useMemo(
    () => `/courses/${encodeURIComponent(courseCode)}/modules`,
    [courseCode],
  )

  const itemPath = useCallback(
    (a: CourseCalendarAssignment) => {
      if (a.kind === 'assignment') return `${modulesBase}/assignment/${encodeURIComponent(a.id)}`
      if (a.kind === 'quiz') return `${modulesBase}/quiz/${encodeURIComponent(a.id)}`
      return `${modulesBase}/content/${encodeURIComponent(a.id)}`
    },
    [modulesBase],
  )

  function assignmentRow(a: CourseCalendarAssignment) {
    return (
      <li key={a.id}>
        <Link
          to={itemPath(a)}
          className="group flex flex-col gap-0.5 rounded-xl border border-slate-200/90 bg-white px-4 py-3 shadow-sm transition hover:border-indigo-200 hover:bg-indigo-50/40 dark:border-neutral-600 dark:bg-neutral-800/80 dark:hover:border-indigo-500/50 dark:hover:bg-indigo-950/40"
        >
          <span className="text-sm font-semibold tracking-tight text-slate-950 group-hover:text-indigo-800 dark:text-neutral-100 dark:group-hover:text-indigo-300">
            {a.title || 'Untitled'}
          </span>
          <span className="text-xs text-slate-500 dark:text-neutral-400">{formatDueShort(a.dueAt)}</span>
        </Link>
      </li>
    )
  }

  const calendarViewTabs = (
    <div
      className="inline-flex max-w-full flex-wrap justify-center gap-1 rounded-2xl border border-slate-200/90 bg-slate-50/80 p-1 dark:border-neutral-700 dark:bg-neutral-800/90"
      role="tablist"
      aria-label="Calendar view"
    >
      <ViewTab
        active={view === 'month'}
        onClick={() => setView('month')}
        icon={<CalendarDays className="h-4 w-4 shrink-0" aria-hidden />}
        label="Month"
      />
      <ViewTab
        active={view === 'week'}
        onClick={() => setView('week')}
        icon={<LayoutList className="h-4 w-4 shrink-0" aria-hidden />}
        label="Week"
      />
      <ViewTab
        active={view === 'todo'}
        onClick={() => setView('todo')}
        icon={<ListTodo className="h-4 w-4 shrink-0" aria-hidden />}
        label="To-do"
      />
    </div>
  )

  return (
    <div className="mt-8">
      {view === 'month' && (
        <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm dark:border-neutral-700 dark:bg-neutral-900/90 md:p-6">
          <div className="mb-4 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
            <h2 className="shrink-0 text-lg font-semibold tracking-tight text-slate-950 dark:text-neutral-100">
              {monthAnchor.toLocaleString(undefined, { month: 'long', year: 'numeric' })}
            </h2>
            <div className="flex min-w-0 flex-1 basis-[12rem] justify-center">{calendarViewTabs}</div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
                aria-label="Previous month"
                onClick={() => setMonthAnchor((m) => addMonths(m, -1))}
              >
                <ChevronLeft className="h-5 w-5" aria-hidden />
              </button>
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
                aria-label="Next month"
                onClick={() => setMonthAnchor((m) => addMonths(m, 1))}
              >
                <ChevronRight className="h-5 w-5" aria-hidden />
              </button>
            </div>
          </div>
          {rescheduleError ? (
            <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-200">
              {rescheduleError}
            </p>
          ) : null}
          <DndContext
            sensors={dragSensors}
            collisionDetection={pointerWithin}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragCancel={onDragCancel}
          >
            <div
              className={`grid grid-cols-7 gap-px rounded-xl bg-slate-200/90 dark:bg-neutral-700/90 ${rescheduleBusy ? 'pointer-events-none opacity-60' : ''}`}
            >
              {WEEKDAY_LABELS.map((w) => (
                <div
                  key={w}
                  className="bg-slate-50 px-1 py-2 text-center text-xs font-semibold uppercase tracking-wide text-slate-500 dark:bg-neutral-800 dark:text-neutral-400"
                >
                  {w}
                </div>
              ))}
              {monthCells.map((cell) => {
                const key = dateKeyLocal(cell)
                const dayItems = itemsByDay.get(key) ?? []
                return (
                  <CalendarMonthDayCell
                    key={cell.toISOString()}
                    cell={cell}
                    monthAnchor={monthAnchor}
                    now={now}
                    dayItems={dayItems}
                    canDragReschedule={canRescheduleDueByDrag}
                    itemPath={itemPath}
                    onShowAssignmentHover={showAssignmentHover}
                    onHideAssignmentHover={hideAssignmentHover}
                    focusDateKey={initialDateKey}
                  />
                )
              })}
            </div>
            <DragOverlay dropAnimation={null}>
              {activeDragAssignment ? (
                <div className="max-w-[14rem] truncate rounded-md border border-indigo-200/90 bg-indigo-50 px-2 py-1 text-left text-[11px] font-semibold text-indigo-950 shadow-md dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-100">
                  {activeDragAssignment.title || 'Untitled'}
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
          <p className="mt-4 text-xs text-slate-500 dark:text-neutral-400">
            {canRescheduleDueByDrag
              ? 'Drag a due chip to another day to reschedule (the time of day is kept). '
              : ''}
            Each label is a due item; click to open it. Times use your local time zone.
          </p>
        </div>
      )}

      {view === 'week' && (
        <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm dark:border-neutral-700 dark:bg-neutral-900/90 md:p-6">
          <div className="mb-4 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
            <div className="min-w-0 shrink-0">
              <h2 className="text-lg font-semibold tracking-tight text-slate-950 dark:text-neutral-100">
                Week view
              </h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
                {weekStart.toLocaleDateString(undefined, { dateStyle: 'medium' })} —{' '}
                {new Date(weekEnd.getTime() - 1).toLocaleDateString(undefined, {
                  dateStyle: 'medium',
                })}
              </p>
            </div>
            <div className="flex min-w-0 flex-1 basis-[12rem] justify-center">{calendarViewTabs}</div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
                aria-label="Previous week"
                onClick={() => {
                  const n = new Date(weekCursor)
                  n.setDate(n.getDate() - 7)
                  setWeekCursor(n)
                }}
              >
                <ChevronLeft className="h-5 w-5" aria-hidden />
              </button>
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
                aria-label="Next week"
                onClick={() => {
                  const n = new Date(weekCursor)
                  n.setDate(n.getDate() + 7)
                  setWeekCursor(n)
                }}
              >
                <ChevronRight className="h-5 w-5" aria-hidden />
              </button>
            </div>
          </div>
          {weekItems.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-neutral-400">Nothing due this week.</p>
          ) : (
            <ul className="space-y-2">{weekItems.map(assignmentRow)}</ul>
          )}
        </div>
      )}

      {view === 'todo' && (
        <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm dark:border-neutral-700 dark:bg-neutral-900/90 md:p-6">
          <div className="mb-4 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
            <div className="min-w-0 shrink-0">
              <h2 className="text-lg font-semibold tracking-tight text-slate-950 dark:text-neutral-100">
                Due today & next 24 hours
              </h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
                Assignments due on today&apos;s date, or with a due time in the next 24 hours.
              </p>
            </div>
            <div className="flex min-w-0 flex-1 basis-[12rem] justify-center">{calendarViewTabs}</div>
            {/* Keeps tab strip aligned with month/week rows (chevron column width). */}
            <div className="h-9 w-[4.75rem] shrink-0 max-sm:hidden" aria-hidden />
          </div>
          {todoItems.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500 dark:text-neutral-400">Nothing in this window.</p>
          ) : (
            <ul className="mt-4 space-y-2">{todoItems.map(assignmentRow)}</ul>
          )}
        </div>
      )}

      <AssignmentHoverPortal open={assignmentHover} />
    </div>
  )
}

type ViewTabProps = {
  active: boolean
  onClick: () => void
  icon: ReactNode
  label: string
}

function ViewTab({ active, onClick, icon, label }: ViewTabProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
        active
          ? 'bg-white text-indigo-800 shadow-sm ring-1 ring-slate-200/90 dark:bg-neutral-900 dark:text-indigo-300 dark:ring-neutral-600'
          : 'text-slate-600 hover:bg-white/70 hover:text-slate-950 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-100'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}
