import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, ChevronLeft, ChevronRight, LayoutList, ListTodo } from 'lucide-react'
import {
  addMonths,
  dateKeyLocal,
  endOfWeekMondayExclusive,
  formatDueShort,
  isInTodoWindow,
  monthGridCells,
  startOfMonth,
  startOfWeekMonday,
} from '../../lib/courseCalendarUtils'

export type CourseCalendarAssignment = {
  id: string
  title: string
  dueAt: string
  /** Drives the correct module URL (`content`, `assignment`, or `quiz`). */
  kind: 'content_page' | 'assignment' | 'quiz'
}

type ViewId = 'month' | 'week' | 'todo'

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

type CourseCalendarProps = {
  courseCode: string
  assignments: CourseCalendarAssignment[]
}

export function CourseCalendar({ courseCode, assignments }: CourseCalendarProps) {
  const [view, setView] = useState<ViewId>('month')
  const [monthAnchor, setMonthAnchor] = useState(() => startOfMonth(new Date()))
  const [weekCursor, setWeekCursor] = useState(() => new Date())

  const sorted = useMemo(
    () => [...assignments].sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()),
    [assignments],
  )

  const now = new Date()

  const monthCells = useMemo(() => monthGridCells(monthAnchor), [monthAnchor])
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

  const modulesBase = `/courses/${encodeURIComponent(courseCode)}/modules`

  function itemPath(a: CourseCalendarAssignment) {
    if (a.kind === 'assignment') return `${modulesBase}/assignment/${encodeURIComponent(a.id)}`
    if (a.kind === 'quiz') return `${modulesBase}/quiz/${encodeURIComponent(a.id)}`
    return `${modulesBase}/content/${encodeURIComponent(a.id)}`
  }

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

  return (
    <div className="mt-8 space-y-6">
      <div
        className="flex flex-wrap gap-2 rounded-2xl border border-slate-200/90 bg-slate-50/80 p-1.5 dark:border-neutral-700 dark:bg-neutral-800/90"
        role="tablist"
        aria-label="Calendar view"
      >
        <ViewTab
          active={view === 'month'}
          onClick={() => setView('month')}
          icon={<CalendarDays className="h-4 w-4" aria-hidden />}
          label="Month"
        />
        <ViewTab
          active={view === 'week'}
          onClick={() => setView('week')}
          icon={<LayoutList className="h-4 w-4" aria-hidden />}
          label="Week"
        />
        <ViewTab
          active={view === 'todo'}
          onClick={() => setView('todo')}
          icon={<ListTodo className="h-4 w-4" aria-hidden />}
          label="To-do"
        />
      </div>

      {view === 'month' && (
        <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm dark:border-neutral-700 dark:bg-neutral-900/90 md:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold tracking-tight text-slate-950 dark:text-neutral-100">
              {monthAnchor.toLocaleString(undefined, { month: 'long', year: 'numeric' })}
            </h2>
            <div className="flex items-center gap-1">
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
          <div className="grid grid-cols-7 gap-px rounded-xl bg-slate-200/90 dark:bg-neutral-700/90">
            {WEEKDAY_LABELS.map((w) => (
              <div
                key={w}
                className="bg-slate-50 px-1 py-2 text-center text-xs font-semibold uppercase tracking-wide text-slate-500 dark:bg-neutral-800 dark:text-neutral-400"
              >
                {w}
              </div>
            ))}
            {monthCells.map((cell) => {
              const inMonth = cell.getMonth() === monthAnchor.getMonth()
              const key = dateKeyLocal(cell)
              const dayItems = itemsByDay.get(key) ?? []
              const isToday = dateKeyLocal(cell) === dateKeyLocal(now)
              return (
                <div
                  key={cell.toISOString()}
                  className={`flex min-h-[5rem] flex-col bg-white p-1.5 text-left dark:bg-neutral-900/95 ${
                    inMonth ? '' : 'bg-slate-50/90 text-slate-400 dark:bg-neutral-950/80 dark:text-neutral-500'
                  }`}
                >
                  <div className="flex shrink-0 items-start">
                    <span
                      className={`inline-flex h-7 min-w-[1.75rem] items-center justify-center rounded-lg text-sm font-medium ${
                        isToday
                          ? 'bg-indigo-600 text-white shadow-sm dark:bg-indigo-500 dark:text-white'
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
                        <li key={a.id} className="min-w-0">
                          <Link
                            to={itemPath(a)}
                            title={`${a.title || 'Untitled'} — ${formatDueShort(a.dueAt)}`}
                            className="block w-full truncate rounded-md bg-indigo-50/90 px-1 py-0.5 text-left text-[11px] font-semibold leading-tight text-indigo-900 transition hover:bg-indigo-100 hover:ring-1 hover:ring-indigo-200/80 dark:bg-indigo-950/50 dark:text-indigo-100 dark:hover:bg-indigo-900/60 dark:hover:ring-indigo-500/40"
                          >
                            {a.title || 'Untitled'}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              )
            })}
          </div>
          <p className="mt-4 text-xs text-slate-500 dark:text-neutral-400">
            Each label is a due item; click to open it. Times use your local time zone.
          </p>
        </div>
      )}

      {view === 'week' && (
        <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm dark:border-neutral-700 dark:bg-neutral-900/90 md:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
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
            <div className="flex items-center gap-1">
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
          <h2 className="text-lg font-semibold tracking-tight text-slate-950 dark:text-neutral-100">
            Due today & next 24 hours
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
            Assignments due on today&apos;s date, or with a due time in the next 24 hours.
          </p>
          {todoItems.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500 dark:text-neutral-400">Nothing in this window.</p>
          ) : (
            <ul className="mt-4 space-y-2">{todoItems.map(assignmentRow)}</ul>
          )}
        </div>
      )}
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
          : 'text-slate-600 hover:bg-white/70 hover:text-slate-950 dark:text-neutral-400 dark:hover:bg-neutral-700/80 dark:hover:text-neutral-100'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}
