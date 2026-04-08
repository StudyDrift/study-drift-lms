/** Compact token count for labels (e.g. 262144 → "262K"). */
export function formatContextTokens(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—'
  if (n >= 1_000_000) {
    const m = n / 1_000_000
    return `${m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)}M`
  }
  if (n >= 10_000) {
    const k = Math.round(n / 1000)
    return `${k}K`
  }
  if (n >= 1_000) {
    const k = n / 1000
    return `${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}K`
  }
  return n.toLocaleString()
}

export function formatUsdPerMillion(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—'
  if (n === 0) return 'Free'
  if (n < 0.01) return `$${n.toFixed(4)}/M`
  return `$${n.toFixed(3)}/M`
}
