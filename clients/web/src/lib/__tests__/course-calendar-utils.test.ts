import { describe, expect, it } from 'vitest'
import {
  addMonths,
  countByDateKey,
  dateKeyLocal,
  endOfWeekMondayExclusive,
  formatDueShort,
  isInTodoWindow,
  mergeLocalCalendarDayPreserveWallClock,
  monthGridCells,
  startOfMonth,
  startOfWeekMonday,
} from '../course-calendar-utils'

describe('dateKeyLocal', () => {
  it('formats local calendar day as YYYY-MM-DD', () => {
    expect(dateKeyLocal(new Date(2026, 3, 9))).toBe('2026-04-09')
    expect(dateKeyLocal(new Date(2026, 0, 1))).toBe('2026-01-01')
  })
})

describe('startOfMonth', () => {
  it('returns the first day of the month at local midnight', () => {
    const d = startOfMonth(new Date(2026, 6, 15))
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(6)
    expect(d.getDate()).toBe(1)
  })
})

describe('addMonths', () => {
  it('advances the month anchor by delta months', () => {
    const a = addMonths(new Date(2026, 0, 15), 2)
    expect(a.getFullYear()).toBe(2026)
    expect(a.getMonth()).toBe(2)
    expect(a.getDate()).toBe(1)
  })
})

describe('monthGridCells', () => {
  it('returns 42 dates starting Monday of the week containing the 1st', () => {
    const cells = monthGridCells(new Date(2026, 3, 9))
    expect(cells).toHaveLength(42)
    expect(cells[0]!.getDay()).toBe(1)
  })
})

describe('countByDateKey', () => {
  it('counts occurrences per key', () => {
    const m = countByDateKey(['2026-04-09', '2026-04-09', '2026-04-10'])
    expect(m.get('2026-04-09')).toBe(2)
    expect(m.get('2026-04-10')).toBe(1)
  })
})

describe('startOfWeekMonday', () => {
  it('returns Monday 00:00:00 local for the week containing d', () => {
    const thu = new Date(2026, 3, 9)
    const mon = startOfWeekMonday(thu)
    expect(mon.getDay()).toBe(1)
    expect(mon.getHours()).toBe(0)
    expect(mon.getMinutes()).toBe(0)
  })
})

describe('endOfWeekMondayExclusive', () => {
  it('is seven days after startOfWeekMonday', () => {
    const d = new Date(2026, 3, 9)
    const start = startOfWeekMonday(d)
    const end = endOfWeekMondayExclusive(d)
    expect(end.getTime() - start.getTime()).toBe(7 * 24 * 60 * 60 * 1000)
  })
})

describe('isInTodoWindow', () => {
  it('is true when due is later today', () => {
    const now = new Date(2026, 3, 9, 10, 0, 0)
    const due = new Date(2026, 3, 9, 18, 0, 0)
    expect(isInTodoWindow(due, now)).toBe(true)
  })

  it('is true when due is strictly after now and within 24h', () => {
    const now = new Date(2026, 3, 9, 10, 0, 0)
    const due = new Date(2026, 3, 10, 8, 0, 0)
    expect(isInTodoWindow(due, now)).toBe(true)
  })

  it('is false when due is tomorrow but beyond 24h from now', () => {
    const now = new Date(2026, 3, 9, 10, 0, 0)
    const due = new Date(2026, 3, 10, 12, 0, 0)
    expect(isInTodoWindow(due, now)).toBe(false)
  })
})

describe('formatDueShort', () => {
  it('returns an em dash when date is invalid', () => {
    expect(formatDueShort('not-a-date')).toBe('—')
  })

  it('formats valid ISO strings', () => {
    const s = '2026-04-09T15:30:00.000Z'
    const out = formatDueShort(s)
    expect(out.length).toBeGreaterThan(4)
    expect(out).not.toBe(s)
  })
})

describe('mergeLocalCalendarDayPreserveWallClock', () => {
  it('moves the local calendar day and keeps local time-of-day', () => {
    const prevLocal = new Date(2026, 3, 9, 14, 30, 45, 120)
    const iso = prevLocal.toISOString()
    const targetDay = new Date(2026, 3, 21)
    const out = new Date(mergeLocalCalendarDayPreserveWallClock(targetDay, iso))
    expect(out.getFullYear()).toBe(2026)
    expect(out.getMonth()).toBe(3)
    expect(out.getDate()).toBe(21)
    expect(out.getHours()).toBe(14)
    expect(out.getMinutes()).toBe(30)
    expect(out.getSeconds()).toBe(45)
    expect(out.getMilliseconds()).toBe(120)
  })

  it('returns the original string when previous due is not a date', () => {
    expect(mergeLocalCalendarDayPreserveWallClock(new Date(2026, 3, 1), 'x')).toBe('x')
  })
})
