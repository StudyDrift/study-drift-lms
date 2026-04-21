import { useEffect, useId, useState } from 'react'
import { X } from 'lucide-react'

export type LtiToolOption = { id: string; name: string }

type ModuleLtiLinkModalProps = {
  open: boolean
  onClose: () => void
  onSave: (input: {
    title: string
    externalToolId: string
    resourceLinkId: string
    lineItemUrl: string
  }) => void | Promise<void>
  tools: LtiToolOption[]
  toolsLoading?: boolean
  saving?: boolean
  errorMessage?: string | null
}

export function ModuleLtiLinkModal(props: ModuleLtiLinkModalProps) {
  if (!props.open) return null
  return <ModuleLtiLinkModalInner {...props} />
}

function ModuleLtiLinkModalInner({
  onClose,
  onSave,
  tools,
  toolsLoading = false,
  saving = false,
  errorMessage,
}: ModuleLtiLinkModalProps) {
  const titleId = useId()
  const titleFieldId = useId()
  const toolFieldId = useId()
  const rlFieldId = useId()
  const liFieldId = useId()
  const [title, setTitle] = useState('')
  const [externalToolId, setExternalToolId] = useState('')
  const [resourceLinkId, setResourceLinkId] = useState('')
  const [lineItemUrl, setLineItemUrl] = useState('')

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
            Add LTI tool link
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
            const tid = externalToolId.trim()
            if (!t || !tid || saving || toolsLoading) return
            void onSave({
              title: t,
              externalToolId: tid,
              resourceLinkId: resourceLinkId.trim(),
              lineItemUrl: lineItemUrl.trim(),
            })
          }}
        >
          <label htmlFor={titleFieldId} className="text-xs font-medium text-slate-600 dark:text-neutral-300">
            Title
          </label>
          <input
            id={titleFieldId}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Publisher homework"
            autoFocus
            disabled={saving}
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-indigo-500/20 placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500"
          />
          <label htmlFor={toolFieldId} className="mt-4 block text-xs font-medium text-slate-600 dark:text-neutral-300">
            External tool
          </label>
          <select
            id={toolFieldId}
            value={externalToolId}
            onChange={(e) => setExternalToolId(e.target.value)}
            disabled={saving || toolsLoading || tools.length === 0}
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
          >
            <option value="">{toolsLoading ? 'Loading…' : 'Select a registered tool'}</option>
            {tools.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs text-slate-500 dark:text-neutral-400">
            Tools are registered under Settings → LTI tools (administrators).
          </p>
          <label htmlFor={rlFieldId} className="mt-4 block text-xs font-medium text-slate-600 dark:text-neutral-300">
            Resource link id (optional)
          </label>
          <input
            id={rlFieldId}
            type="text"
            value={resourceLinkId}
            onChange={(e) => setResourceLinkId(e.target.value)}
            disabled={saving}
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 disabled:opacity-60 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
          />
          <label htmlFor={liFieldId} className="mt-4 block text-xs font-medium text-slate-600 dark:text-neutral-300">
            AGS line item URL (optional, for grade passback)
          </label>
          <input
            id={liFieldId}
            type="url"
            inputMode="url"
            value={lineItemUrl}
            onChange={(e) => setLineItemUrl(e.target.value)}
            disabled={saving}
            placeholder="https://…"
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 disabled:opacity-60 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
          />
          {errorMessage ? (
            <p className="mt-3 text-sm text-rose-600 dark:text-rose-400" role="alert">
              {errorMessage}
            </p>
          ) : null}
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => onClose()}
              disabled={saving}
              className="rounded-xl px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:text-neutral-200 dark:hover:bg-neutral-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || toolsLoading || !title.trim() || !externalToolId.trim()}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-indigo-500 dark:hover:bg-indigo-400"
            >
              {saving ? 'Saving…' : 'Add'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
