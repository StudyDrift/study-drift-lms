import { useState } from 'react'
import { ExternalLink, X } from 'lucide-react'

export type OriginalityReportViewerProps = {
  open: boolean
  onClose: () => void
  embedUrl: string
  title?: string
}

export function OriginalityReportViewer({
  open,
  onClose,
  embedUrl,
  title = 'Originality report',
}: OriginalityReportViewerProps) {
  const [tab, setTab] = useState<'embed' | 'new'>('embed')
  const isProbablyHttp = /^https?:\/\//i.test(embedUrl)

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
            {isProbablyHttp ? (
              <button
                type="button"
                className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-900"
                onClick={() => setTab((t) => (t === 'embed' ? 'new' : 'embed'))}
              >
                {tab === 'embed' ? 'Open in new tab' : 'Show embedded'}
              </button>
            ) : null}
            <a
              href={embedUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50 dark:border-neutral-600 dark:text-indigo-300 dark:hover:bg-neutral-900"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              Link
            </a>
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
        <div className="min-h-[50vh] flex-1 bg-slate-50 dark:bg-neutral-900/40">
          {tab === 'embed' && isProbablyHttp ? (
            <iframe title={title} src={embedUrl} className="h-[70vh] w-full border-0" />
          ) : (
            <div className="flex h-[70vh] flex-col items-center justify-center gap-3 p-6 text-center text-sm text-slate-600 dark:text-neutral-300">
              <p>This report cannot be embedded here. Use the link to open it in a new tab.</p>
              <a
                href={embedUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
              >
                Open report
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
