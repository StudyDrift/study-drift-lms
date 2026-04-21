import { courseItemsCreatePermission } from './courses-api'
import type { SearchCourseItem } from './search-api'
import type { SearchListItem } from './build-search-items'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function enc(s: string): string {
  return encodeURIComponent(s)
}

/** Returns normalized lowercase UUID if the query is or contains a single UUID token. */
export function extractUuidFromQuery(query: string): string | null {
  const t = query.trim()
  if (UUID_RE.test(t)) return t.toLowerCase()
  const words = t.split(/\s+/).filter(Boolean)
  if (words.length === 1 && UUID_RE.test(words[0]!)) return words[0]!.toLowerCase()
  const loose = t.match(UUID_RE)
  return loose?.[0]?.toLowerCase() ?? null
}

/** Parses common typed date shapes into `YYYY-MM-DD` (local calendar), or null. */
export function parseCalendarDateFromQuery(query: string): string | null {
  const t = query.trim()
  if (!t) return null

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t)
  if (iso) {
    const y = Number(iso[1])
    const mo = Number(iso[2])
    const d = Number(iso[3])
    if (validYmd(y, mo, d)) return `${iso[1]}-${iso[2]}-${iso[3]}`
  }

  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(t)
  if (us) {
    const month = Number(us[1])
    const day = Number(us[2])
    let year = Number(us[3])
    if (year < 100) year += 2000
    if (validYmd(year, month, day)) return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }

  const monthFirst = /^([A-Za-z]{3,9})\s+(\d{1,2})(?:,?\s*(\d{4}))?$/.exec(t)
  if (monthFirst) {
    const monthName = monthFirst[1]!.toLowerCase()
    const day = Number(monthFirst[2])
    const year = monthFirst[3] ? Number(monthFirst[3]) : new Date().getFullYear()
    const month = monthFromName(monthName)
    if (month != null && validYmd(year, month, day)) {
      return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    }
  }

  return null
}

function monthFromName(s: string): number | null {
  const months = [
    'january',
    'february',
    'march',
    'april',
    'may',
    'june',
    'july',
    'august',
    'september',
    'october',
    'november',
    'december',
  ]
  const short = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
  const i = months.findIndex((m) => m.startsWith(s))
  if (i >= 0) return i + 1
  const j = short.findIndex((m) => s.startsWith(m))
  return j >= 0 ? j + 1 : null
}

function validYmd(y: number, m: number, d: number): boolean {
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return false
  if (m < 1 || m > 12 || d < 1 || d > 31) return false
  const dt = new Date(y, m - 1, d)
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d
}

function formatUsLong(iso: string): string {
  const [y, m, d] = iso.split('-').map((x) => Number.parseInt(x, 10))
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return iso
  const dt = new Date(y, m - 1, d)
  return dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * Extra command-palette rows for fuzzy "go to" navigation (dates, bank question ids).
 * Person → gradebook row is handled by `buildSearchItems` paths.
 */
export function buildCommandPaletteGoToItems(
  query: string,
  courses: SearchCourseItem[],
  allows: (perm: string) => boolean,
): SearchListItem[] {
  const out: SearchListItem[] = []
  const uuid = extractUuidFromQuery(query)
  if (uuid) {
    for (const c of courses) {
      if (c.questionBankEnabled !== true) continue
      if (!allows(courseItemsCreatePermission(c.courseCode))) continue
      const path = `/courses/${enc(c.courseCode)}/questions?question=${enc(uuid)}`
      out.push({
        id: `goto:bank:${c.courseCode}:${uuid}`,
        group: 'goto',
        title: `Question bank — open id`,
        subtitle: `${c.title.trim() || c.courseCode} · ${uuid.slice(0, 8)}…`,
        path,
        haystack: `${uuid} question bank ${c.courseCode} ${c.title} goto`.toLowerCase(),
      })
    }
  }

  const dateKey = parseCalendarDateFromQuery(query)
  if (dateKey) {
    const label = formatUsLong(dateKey)
    out.push({
      id: `goto:calendar:${dateKey}`,
      group: 'goto',
      title: `Calendar — ${label}`,
      subtitle: 'Your schedule hub',
      path: `/calendar?date=${enc(dateKey)}`,
      haystack: `calendar schedule ${dateKey} ${label} goto`.toLowerCase(),
    })
    for (const c of courses) {
      if (c.calendarEnabled === false) continue
      const path = `/courses/${enc(c.courseCode)}/calendar?date=${enc(dateKey)}`
      out.push({
        id: `goto:cal:${c.courseCode}:${dateKey}`,
        group: 'goto',
        title: `Course calendar — ${label}`,
        subtitle: c.title.trim() ? `${c.title} · ${c.courseCode}` : c.courseCode,
        path,
        haystack: `calendar ${dateKey} ${c.title} ${c.courseCode} goto`.toLowerCase(),
      })
    }
  }

  return out
}

/** True when the query should surface go-to rows (uuid or calendar-like date). */
export function queryTriggersGoToItems(query: string): boolean {
  return Boolean(extractUuidFromQuery(query) || parseCalendarDateFromQuery(query))
}
