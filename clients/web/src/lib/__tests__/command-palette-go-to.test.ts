import { describe, expect, it } from 'vitest'
import { courseItemsCreatePermission } from '../courses-api'
import {
  buildCommandPaletteGoToItems,
  extractUuidFromQuery,
  parseCalendarDateFromQuery,
} from '../command-palette-go-to'
import type { SearchCourseItem } from '../search-api'

describe('command-palette-go-to', () => {
  it('extracts uuid from trimmed query', () => {
    const id = '550e8400-e29b-41d4-a716-446655440000'
    expect(extractUuidFromQuery(`  ${id}  `)).toBe(id)
  })

  it('parses ISO and US-style dates', () => {
    expect(parseCalendarDateFromQuery('2026-04-21')).toBe('2026-04-21')
    expect(parseCalendarDateFromQuery('4/21/2026')).toBe('2026-04-21')
    expect(parseCalendarDateFromQuery('April 21, 2026')).toBe('2026-04-21')
  })

  it('adds bank and calendar go rows when query matches', () => {
    const qid = '550e8400-e29b-41d4-a716-446655440000'
    const courses: SearchCourseItem[] = [
      { courseCode: 'CS-1', title: 'Intro', questionBankEnabled: true, calendarEnabled: true },
    ]
    const allows = (p: string) => p === courseItemsCreatePermission('CS-1')
    const items = buildCommandPaletteGoToItems(qid, courses, allows)
    expect(items.some((i) => i.path.includes('/questions?question='))).toBe(true)
    const dateItems = buildCommandPaletteGoToItems('2026-05-01', courses, allows)
    expect(dateItems.some((i) => i.path.startsWith('/calendar?'))).toBe(true)
    expect(dateItems.some((i) => i.path.includes('/calendar?date='))).toBe(true)
  })
})
