import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, ChevronLeft, ChevronRight, LayoutList, ListTodo } from 'lucide-react'
import {
  addMonths,
  dateKeyLocal,
  countByDateKey,
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
  const countsByDay = useMemo(() => {
    const keys = sorted.map((a) => dateKeyLocal(new Date(a.dueAt)))
    return countByDateKey(keys)
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

  const contentBase = `/courses/${encodeURIComponent(courseCode)}/modules/content`

  function assignmentRow(a: CourseCalendarAssignment) {
    return (
      <li key={a.id}>
        <Link
          to={`${contentBase}/${encodeURIComponent(a.id)}`}
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
              const n = countsByDay.get(key) ?? 0
              const isToday = dateKeyLocal(cell) === dateKeyLocal(now)
              return (
                <div
                  key={cell.toISOString()}
                  className={`min-h-[4.5rem] bg-white p-1.5 text-left dark:bg-neutral-900/95 ${
                    inMonth ? '' : 'bg-slate-50/90 text-slate-400 dark:bg-neutral-950/80 dark:text-neutral-500'
                  }`}
                >
                  <div className="flex items-start justify-between gap-1">
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
                    {n > 0 ? (
                      <span
                        className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-indigo-100 px-1.5 py-0.5 text-xs font-bold text-indigo-800 dark:bg-indigo-950/90 dark:text-indigo-200"
                        title={`${n} assignment${n === 1 ? '' : 's'} due`}
                      >
                        {n}
                      </span>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
          <p className="mt-4 text-xs text-slate-500 dark:text-neutral-400">
            Numbers show how many assignments are due that day (course time zone: your local time).
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
