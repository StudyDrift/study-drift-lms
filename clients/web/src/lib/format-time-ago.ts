/** English phrases like "15 minutes ago" / "5 weeks ago" (past times only). */
export function formatTimeAgoFromIso(iso: string | null | undefined, nowMs = Date.now()): string {
  if (iso == null || iso === '') return 'Never'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 'Never'
  let seconds = Math.floor((nowMs - then) / 1000)
  if (seconds < 0) seconds = 0

  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

  const intervals: { unit: Intl.RelativeTimeFormatUnit; seconds: number }[] = [
    { unit: 'year', seconds: 31536000 },
    { unit: 'month', seconds: 2592000 },
    { unit: 'week', seconds: 604800 },
    { unit: 'day', seconds: 86400 },
    { unit: 'hour', seconds: 3600 },
    { unit: 'minute', seconds: 60 },
    { unit: 'second', seconds: 1 },
  ]

  for (const { unit, seconds: secPer } of intervals) {
    const count = Math.floor(seconds / secPer)
    if (count >= 1) {
      return rtf.format(-count, unit)
    }
  }

  return rtf.format(0, 'second')
}
