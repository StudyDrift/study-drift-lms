import { useState } from 'react'
import { ExternalLink, X } from 'lucide-react'

import type { OriginalityReportSummary } from '../../lib/courses-api'

export type OriginalityReportViewerProps = {
  open: boolean
  onClose: () => void
  embedUrl: string
  /** Plan 3.14 — fallback from server when embed / provider link is unavailable. */
  storedSummary?: OriginalityReportSummary | null
  /** When true, show only the stored summary panel (no iframe). */
  viewStoredSummaryOnly?: boolean
  title?: string
}

function pctLine(label: string, n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return null
  return (
    <li>
      {label}: {n.toFixed(1)}%
    </li>
  )
}

export function OriginalityReportViewer({
  open,
  onClose,
  embedUrl,
  storedSummary = null,
  viewStoredSummaryOnly = false,
  title = 'Originality report',
}: OriginalityReportViewerProps) {
  const [tab, setTab] = useState<'embed' | 'new'>('embed')
  const isProbablyHttp = /^https?:\/\//i.test(embedUrl)
  const showStoredSummaryView =
    (viewStoredSummaryOnly && storedSummary) || (!viewStoredSummaryOnly && tab === 'new' && storedSummary)

  const handleClose = () => {
    setTab('embed')
    onClose()
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-950">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-neutral-800">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-neutral-50">{title}</h3>
          <div className="flex items-center gap-2">
            {!viewStoredSummaryOnly && storedSummary && embedUrl ? (
              <button
                type="button"
                className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-900"
                onClick={() => setTab((t) => (t === 'embed' ? 'new' : 'embed'))}
              >
                {tab === 'embed' ? 'Stored summary' : isProbablyHttp ? 'Show embedded' : 'Back'}
              </button>
            ) : null}
            {!viewStoredSummaryOnly && embedUrl ? (
              <a
                href={embedUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50 dark:border-neutral-600 dark:text-indigo-300 dark:hover:bg-neutral-900"
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                Link
              </a>
            ) : null}
            <button
              type="button"
              onClick={handleClose}
              className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-neutral-100"
              aria-label="Close originality viewer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        {showStoredSummaryView && storedSummary ? (
          <div
            role="region"
            aria-label="Stored originality report summary"
            className="min-h-[50vh] flex-1 overflow-y-auto bg-slate-50 p-6 text-sm text-slate-800 dark:bg-neutral-900/40 dark:text-neutral-100"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-neutral-400">
              {storedSummary.provider} · stored report
            </p>
            <ul className="mt-3 list-inside list-disc space-y-1.5 text-slate-700 dark:text-neutral-200">
              {pctLine('Similarity', storedSummary.similarityPct)}
              {pctLine('AI authorship', storedSummary.aiProbability)}
              {storedSummary.detectedAt ? (
                <li>Report date: {new Date(storedSummary.detectedAt).toLocaleString()}</li>
              ) : null}
            </ul>
            {storedSummary.fullReportUnavailableMessage ? (
              <p className="mt-4 rounded-md border border-amber-200 bg-amber-50/90 px-3 py-2 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100">
                {storedSummary.fullReportUnavailableMessage}
              </p>
            ) : storedSummary.fullReportUnavailable ? (
              <p className="mt-4 text-slate-600 dark:text-neutral-400">
                Full report is unavailable in an embedded view. Use the scores above, or the link
                (when available) to open the provider.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="min-h-[50vh] flex-1 bg-slate-50 dark:bg-neutral-900/40">
            {tab === 'embed' && isProbablyHttp ? (
              <iframe title={title} src={embedUrl} className="h-[70vh] w-full border-0" />
            ) : (
              <div className="flex h-[70vh] flex-col items-center justify-center gap-3 p-6 text-center text-sm text-slate-600 dark:text-neutral-300">
                {storedSummary && !viewStoredSummaryOnly ? (
                  <p>Switch to &ldquo;Stored summary&rdquo; for the archived similarity and AI scores.</p>
                ) : (
                  <>
                    <p>This report cannot be embedded here. Use the link to open it in a new tab.</p>
                    {embedUrl ? (
                      <a
                        href={embedUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
                      >
                        Open report
                      </a>
                    ) : null}
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
