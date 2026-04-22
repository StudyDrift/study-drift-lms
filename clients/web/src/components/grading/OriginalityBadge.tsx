import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'
import type { OriginalityReportApi } from '../../lib/courses-api'

export type OriginalityBadgeProps = {
  reports: OriginalityReportApi[]
  /** 0–100 thresholds for similarity colouring (defaults match server migration). */
  amberMin?: number
  redMin?: number
  aiAmberMin?: number
  aiRedMin?: number
}

function bandForScore(score: number | null, amber: number, red: number): 'neutral' | 'amber' | 'red' {
  if (score == null || Number.isNaN(score)) return 'neutral'
  if (score >= red) return 'red'
  if (score >= amber) return 'amber'
  return 'neutral'
}

function chipClass(band: 'neutral' | 'amber' | 'red'): string {
  if (band === 'red') {
    return 'border-rose-300 bg-rose-50 text-rose-950 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-50'
  }
  if (band === 'amber') {
    return 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-50'
  }
  return 'border-slate-200 bg-slate-50 text-slate-800 dark:border-neutral-600 dark:bg-neutral-900/60 dark:text-neutral-100'
}

export function OriginalityBadge({
  reports,
  amberMin = 25,
  redMin = 50,
  aiAmberMin = 25,
  aiRedMin = 50,
}: OriginalityBadgeProps) {
  if (!reports.length) return null

  const sim = reports.find((r) => r.similarityPct != null)?.similarityPct ?? null
  const ai = reports.find((r) => r.aiProbability != null)?.aiProbability ?? null
  const pending = reports.some((r) => r.status === 'pending' || r.status === 'processing')
  const failed = reports.some((r) => r.status === 'failed')

  const simBand = bandForScore(sim, amberMin, redMin)
  const aiBand = bandForScore(ai, aiAmberMin, aiRedMin)

  const parts: { key: string; label: string; band: 'neutral' | 'amber' | 'red'; icon?: 'ok' | 'warn' }[] = []
  if (sim != null) {
    parts.push({
      key: 'sim',
      label: `${Math.round(sim)}% similarity`,
      band: simBand,
      icon: simBand === 'red' ? 'warn' : simBand === 'amber' ? 'warn' : 'ok',
    })
  }
  if (ai != null) {
    parts.push({
      key: 'ai',
      label: `${Math.round(ai)}% AI probability`,
      band: aiBand,
      icon: aiBand === 'red' ? 'warn' : aiBand === 'amber' ? 'warn' : 'ok',
    })
  }

  const ariaParts = [
    ...parts.map((p) => `${p.label}, ${p.band}`),
    pending ? 'detection in progress' : '',
    failed ? 'detection error' : '',
  ]
    .filter(Boolean)
    .join('; ')

  return (
    <div className="flex flex-wrap items-center gap-2" role="status" aria-label={ariaParts || 'Originality status'}>
      {pending ? (
        <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 dark:border-neutral-600 dark:bg-neutral-950 dark:text-neutral-200">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          Checking academic integrity…
        </span>
      ) : null}
      {failed ? (
        <span className="inline-flex items-center gap-1 rounded-full border border-rose-300 bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-900 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-100">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
          Detection issue
        </span>
      ) : null}
      {parts.map((p) => (
        <span
          key={p.key}
          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${chipClass(p.band)}`}
        >
          {p.icon === 'ok' ? <CheckCircle2 className="h-3.5 w-3.5 opacity-70" aria-hidden /> : null}
          {p.icon === 'warn' ? <AlertTriangle className="h-3.5 w-3.5 opacity-80" aria-hidden /> : null}
          {p.label}
        </span>
      ))}
    </div>
  )
}
