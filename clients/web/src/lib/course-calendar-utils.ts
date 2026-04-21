import { formatAbsoluteShort } from './format-datetime'

/** Local calendar day key (YYYY-MM-DD) for bucketing due dates. */
export function dateKeyLocal(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

export function addMonths(monthAnchor: Date, delta: number): Date {
  return new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() + delta, 1)
}

/** 42 cells (6 weeks), Monday-first. */
export function monthGridCells(monthAnchor: Date): Date[] {
  const start = startOfMonth(monthAnchor)
  const mondayOffset = (start.getDay() + 6) % 7
  const gridStart = new Date(start)
  gridStart.setDate(start.getDate() - mondayOffset)
  const cells: Date[] = []
  for (let i = 0; i < 42; i++) {
    const c = new Date(gridStart)
    c.setDate(gridStart.getDate() + i)
    cells.push(c)
  }
  return cells
}

export function countByDateKey(dueKeys: string[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const k of dueKeys) {
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  return m
}

export function startOfWeekMonday(d: Date): Date {
  const x = new Date(d)
  const mondayOffset = (x.getDay() + 6) % 7
  x.setDate(x.getDate() - mondayOffset)
  x.setHours(0, 0, 0, 0)
  return x
}

export function endOfWeekMondayExclusive(d: Date): Date {
  const s = startOfWeekMonday(d)
  const e = new Date(s)
  e.setDate(s.getDate() + 7)
  return e
}

/** Due today (local calendar day) or strictly after now and within the next 24 hours. */
export function isInTodoWindow(due: Date, now: Date): boolean {
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const endNext24 = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate())
  const dueIsToday = dueDay.getTime() === startToday.getTime()
  const dueInNext24h = due.getTime() > now.getTime() && due.getTime() <= endNext24.getTime()
  return dueIsToday || dueInNext24h
}

export function formatDueShort(iso: string): string {
  return formatAbsoluteShort(iso)
}

/**
 * Uses the local calendar date from `targetDayLocal` (e.g. a month cell) and keeps the same local
 * wall-clock time as the previous due instant — used when dragging a due item to another day.
 */
export function mergeLocalCalendarDayPreserveWallClock(
  targetDayLocal: Date,
  previousDueIso: string,
): string {
  const prev = new Date(previousDueIso)
  if (Number.isNaN(prev.getTime())) return previousDueIso
  const next = new Date(
    targetDayLocal.getFullYear(),
    targetDayLocal.getMonth(),
    targetDayLocal.getDate(),
    prev.getHours(),
    prev.getMinutes(),
    prev.getSeconds(),
    prev.getMilliseconds(),
  )
  return next.toISOString()
}
