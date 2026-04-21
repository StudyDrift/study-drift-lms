import { useEffect, useId, useState } from 'react'
import { X } from 'lucide-react'

type ModuleNameModalProps = {
  open: boolean
  onClose: () => void
  onSave: (title: string) => void | Promise<void>
  saving?: boolean
  errorMessage?: string | null
  /** Adjusts labels only. */
  mode?:
    | 'module'
    | 'heading'
    | 'content_page'
    | 'assignment'
    | 'quiz'
    | 'external_link'
    | 'lti_link'
  /** Prefill the input (e.g. edit title). */
  initialTitle?: string
  /** Overrides the dialog heading (e.g. "Edit title"). */
  dialogTitleOverride?: string
  /** Overrides the primary submit button label. */
  submitLabelOverride?: string
}

export function ModuleNameModal(props: ModuleNameModalProps) {
  if (!props.open) return null
  return <ModuleNameModalInner {...props} />
}

function ModuleNameModalInner({
  onClose,
  onSave,
  saving = false,
  errorMessage,
  mode = 'module',
  initialTitle = '',
  dialogTitleOverride,
  submitLabelOverride,
}: ModuleNameModalProps) {
  const titleId = useId()
  const inputId = useId()
  const [value, setValue] = useState(initialTitle)

  const dialogTitle =
    mode === 'heading'
      ? 'New heading'
      : mode === 'content_page'
        ? 'New content page'
        : mode === 'assignment'
          ? 'New assignment'
          : mode === 'quiz'
            ? 'New quiz'
            : mode === 'external_link' || mode === 'lti_link'
              ? mode === 'lti_link'
                ? 'LTI tool link'
                : 'External link'
          : 'New module'
  const fieldLabel =
    mode === 'heading'
      ? 'Heading title'
      : mode === 'content_page'
        ? 'Page name'
        : mode === 'assignment'
          ? 'Assignment name'
          : mode === 'quiz'
            ? 'Quiz name'
            : mode === 'external_link' || mode === 'lti_link'
              ? 'Link title'
          : 'Module name'
  const placeholder =
    mode === 'heading'
      ? 'e.g. Readings and discussion'
      : mode === 'content_page'
        ? 'e.g. Week 1 overview'
        : mode === 'assignment'
          ? 'e.g. Problem set 1'
          : mode === 'quiz'
            ? 'e.g. Week 1 check-in'
            : mode === 'external_link' || mode === 'lti_link'
              ? 'e.g. Textbook website'
          : 'e.g. Week 1 — Introduction'
  const submitLabel =
    mode === 'heading'
      ? 'Save heading'
      : mode === 'content_page'
        ? 'Save page'
        : mode === 'assignment'
          ? 'Save assignment'
          : mode === 'quiz'
            ? 'Save quiz'
            : mode === 'external_link' || mode === 'lti_link'
              ? 'Save title'
          : 'Save module'

  const headingText = dialogTitleOverride ?? dialogTitle
  const primarySubmitLabel = submitLabelOverride ?? submitLabel

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
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h3 id={titleId} className="text-sm font-semibold text-slate-900">
            {headingText}
          </h3>
          <button
            type="button"
            onClick={() => onClose()}
            disabled={saving}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <form
          className="p-4"
          onSubmit={(e) => {
            e.preventDefault()
            const t = value.trim()
            if (!t || saving) return
            void onSave(t)
          }}
        >
          <label htmlFor={inputId} className="text-xs font-medium text-slate-600">
            {fieldLabel}
          </label>
          <input
            id={inputId}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            autoFocus
            disabled={saving}
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-indigo-500/20 placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
          />
          {errorMessage && (
            <p className="mt-3 text-sm text-rose-700" role="status">
              {errorMessage}
            </p>
          )}
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => onClose()}
              disabled={saving}
              className="rounded-xl px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !value.trim()}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? 'Saving…' : primarySubmitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
