import { useEffect, useId, useRef, type ReactNode } from 'react'

export type ConfirmDialogProps = {
  open: boolean
  title: string
  description?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** When `'danger'`, confirm button uses destructive styling. */
  variant?: 'default' | 'danger'
  /** If set, user must type this exact string (after trim) to enable Confirm. */
  requireTypedPhrase?: string
  /** Current value of the confirmation phrase field (controlled). */
  typedPhrase?: string
  onTypedPhraseChange?: (value: string) => void
  confirmDisabled?: boolean
  busy?: boolean
  onConfirm: () => void
  onClose: () => void
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  requireTypedPhrase,
  typedPhrase = '',
  onTypedPhraseChange,
  confirmDisabled,
  busy,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const titleId = useId()
  const descId = useId()
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => cancelRef.current?.focus(), 0)
    return () => window.clearTimeout(t)
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, onClose])

  if (!open) return null

  const phraseOk =
    requireTypedPhrase == null || typedPhrase.trim() === requireTypedPhrase.trim()
  const disableConfirm = Boolean(busy || confirmDisabled || !phraseOk)

  return (
    <div className="fixed inset-0 z-[400] flex items-center justify-center p-4" role="presentation">
      <button
        type="button"
        aria-label="Close dialog"
        disabled={busy}
        className="absolute inset-0 cursor-default border-0 bg-black/45 p-0 disabled:cursor-not-allowed"
        onClick={() => {
          if (!busy) onClose()
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        className="relative z-10 w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl dark:border-neutral-700 dark:bg-neutral-900"
      >
        <h2 id={titleId} className="text-lg font-semibold text-slate-950 dark:text-neutral-100">
          {title}
        </h2>
        {description ? (
          <div id={descId} className="mt-2 text-sm text-slate-600 dark:text-neutral-300">
            {description}
          </div>
        ) : null}
        {requireTypedPhrase != null ? (
          <div className="mt-4">
            <label htmlFor="confirm-dialog-phrase" className="text-xs font-medium text-slate-700 dark:text-neutral-200">
              Type <span className="font-mono text-rose-700 dark:text-rose-300">{requireTypedPhrase}</span> to
              confirm
            </label>
            <input
              id="confirm-dialog-phrase"
              key={requireTypedPhrase}
              autoComplete="off"
              value={typedPhrase}
              onChange={(e) => onTypedPhraseChange?.(e.target.value)}
              disabled={busy}
              className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-950 dark:text-neutral-100"
            />
          </div>
        ) : null}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-60 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={disableConfirm}
            onClick={() => {
              if (disableConfirm) return
              onConfirm()
            }}
            className={
              variant === 'danger'
                ? 'rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50'
                : 'rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50'
            }
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
