/**
 * Unified LMS date/time display: short relative lists, absolute detail, ranges,
 * and paired primary + tooltip (absolute) for progressive disclosure.
 */

const absoluteFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

const absoluteShortFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

function asDate(iso: string | Date): Date {
  return typeof iso === 'string' ? new Date(iso) : iso
}

/** Full absolute stamp (matches prior inbox detail style). */
export function formatAbsolute(iso: string | Date | null | undefined): string {
  if (iso == null || iso === '') return '—'
  const d = asDate(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return absoluteFormatter.format(d)
}

/** Compact absolute (e.g. gradebook “last saved”). */
export function formatAbsoluteShort(iso: string | Date | null | undefined): string {
  if (iso == null || iso === '') return '—'
  const d = asDate(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const now = new Date()
  const sameYear = now.getFullYear() === d.getFullYear()
  if (sameYear) {
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  }
  return absoluteShortFormatter.format(d)
}

/** Inbox-style list row: time today, weekday this week, short date older. */
export function formatRelative(iso: string | Date, now: Date = new Date()): string {
  const d = asDate(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfMsg = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diffDays = Math.floor(
    (startOfToday.getTime() - startOfMsg.getTime()) / (24 * 60 * 60 * 1000),
  )
  if (diffDays === 0) {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(d)
  }
  if (diffDays < 7) {
    return new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(d)
  }
  if (d.getFullYear() === now.getFullYear()) {
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(d)
  }
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(d)
}

/** Feed-style compact recency (minutes / hours / days, then short date). */
export function formatRelativeCompact(iso: string | Date, nowMs: number = Date.now()): string {
  const d = asDate(iso)
  const diff = nowMs - d.getTime()
  if (Number.isNaN(diff) || diff < 0) return formatAbsoluteShort(d)
  const sec = Math.floor(diff / 1000)
  if (sec < 45) return 'Just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d`
  const sameYear = new Date().getFullYear() === d.getFullYear()
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

export function formatRange(fromIso: string, toIso: string): string {
  const a = asDate(fromIso)
  const b = asDate(toIso)
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return '—'
  const sameDay =
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  if (sameDay) {
    return `${formatAbsoluteShort(a)} — ${b.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
  }
  return `${formatAbsoluteShort(a)} — ${formatAbsoluteShort(b)}`
}

/** Primary label + ISO tooltip title (alternate form). */
export function dateTimeDisplayPair(
  iso: string | Date,
  mode: 'list' | 'compact' | 'absoluteShort',
  now?: Date,
): { primary: string; title: string } {
  const d = asDate(iso)
  const full = formatAbsolute(d)
  const primary =
    mode === 'list'
      ? formatRelative(d, now)
      : mode === 'compact'
        ? formatRelativeCompact(d, now?.getTime())
        : formatAbsoluteShort(d)
  return { primary, title: full }
}
