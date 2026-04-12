import { useEffect, useId, useState } from 'react'
import { X } from 'lucide-react'

type ModuleExternalLinkModalProps = {
  open: boolean
  onClose: () => void
  onSave: (title: string, url: string) => void | Promise<void>
  saving?: boolean
  errorMessage?: string | null
}

export function ModuleExternalLinkModal(props: ModuleExternalLinkModalProps) {
  if (!props.open) return null
  return <ModuleExternalLinkModalInner {...props} />
}

function ModuleExternalLinkModalInner({
  onClose,
  onSave,
  saving = false,
  errorMessage,
}: ModuleExternalLinkModalProps) {
  const titleId = useId()
  const titleFieldId = useId()
  const urlFieldId = useId()
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (saving) return
      e.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, saving])

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose()
      }}
    >
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-neutral-600 dark:bg-neutral-800">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-neutral-600">
          <h3 id={titleId} className="text-sm font-semibold text-slate-900 dark:text-neutral-100">
            New external link
          </h3>
          <button
            type="button"
            onClick={() => onClose()}
            disabled={saving}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <form
          className="p-4"
          onSubmit={(e) => {
            e.preventDefault()
            const t = title.trim()
            const u = url.trim()
            if (!t || !u || saving) return
            void onSave(t, u)
          }}
        >
          <label htmlFor={titleFieldId} className="text-xs font-medium text-slate-600 dark:text-neutral-300">
            Link title
          </label>
          <input
            id={titleFieldId}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Course textbook"
            autoFocus
            disabled={saving}
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-indigo-500/20 placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500"
          />
          <label
            htmlFor={urlFieldId}
            className="mt-4 block text-xs font-medium text-slate-600 dark:text-neutral-300"
          >
            URL
          </label>
          <input
            id={urlFieldId}
            type="url"
            inputMode="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
            disabled={saving}
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-indigo-500/20 placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500"
          />
          <p className="mt-2 text-xs text-slate-500 dark:text-neutral-400">
            Must start with <span className="font-mono">http://</span> or{' '}
            <span className="font-mono">https://</span>. Learners open this link in a new tab.
          </p>
          {errorMessage && (
            <p className="mt-3 text-sm text-rose-700 dark:text-rose-300" role="status">
              {errorMessage}
            </p>
          )}
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => onClose()}
              disabled={saving}
              className="rounded-xl px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-neutral-300 dark:hover:bg-neutral-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !title.trim() || !url.trim()}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save link'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
