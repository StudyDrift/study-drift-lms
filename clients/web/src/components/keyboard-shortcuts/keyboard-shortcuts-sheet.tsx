import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { shortcutHint } from '../layout/top-bar-utils'

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[11px] font-medium text-slate-600 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
      {children}
    </kbd>
  )
}

type Row = { action: string; keys: string }

function rows(): Row[] {
  const search = shortcutHint()
  return [
    { action: 'Open search & quick actions', keys: search },
    { action: 'Keyboard shortcuts (this sheet)', keys: '?' },
    { action: 'Close search or dialogs', keys: 'Esc' },
    { action: 'Move selection in search results', keys: '↑ ↓' },
    { action: 'Open highlighted result', keys: 'Enter' },
  ]
}

export function KeyboardShortcutsSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const closeBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => closeBtnRef.current?.focus(), 0)
    return () => window.clearTimeout(t)
  }, [open])

  useEffect(() => {
    if (!open) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  if (!open) return null

  const sheet = (
    <div
      className="fixed inset-0 z-[110] flex items-start justify-center px-3 pt-12 pb-[env(safe-area-inset-bottom)] sm:px-4 sm:pt-[min(12vh,6rem)]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="keyboard-shortcuts-title"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default bg-slate-950/55 backdrop-blur-md dark:bg-neutral-950/75"
        aria-label="Close keyboard shortcuts"
        onClick={() => onClose()}
      />
      <div className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-2xl shadow-slate-900/20 dark:border-neutral-700 dark:bg-neutral-900 dark:shadow-black/50">
        <div className="border-b border-slate-200 px-5 py-4 dark:border-neutral-700">
          <h2 id="keyboard-shortcuts-title" className="text-lg font-semibold tracking-tight text-slate-900 dark:text-neutral-100">
            Keyboard shortcuts
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
            Press <Kbd>?</Kbd> anytime (outside of a text field) to open this list.
          </p>
        </div>
        <ul className="max-h-[min(55vh,360px)] divide-y divide-slate-100 overflow-y-auto px-2 py-2 dark:divide-neutral-800">
          {rows().map((row) => (
            <li
              key={row.action}
              className="flex flex-wrap items-center justify-between gap-3 px-3 py-3 text-sm text-slate-800 dark:text-neutral-200"
            >
              <span className="min-w-0 flex-1 leading-snug">{row.action}</span>
              <span className="shrink-0 font-medium text-slate-600 dark:text-neutral-300">{row.keys}</span>
            </li>
          ))}
        </ul>
        <div className="border-t border-slate-100 px-4 py-3 dark:border-neutral-700">
          <button
            ref={closeBtnRef}
            type="button"
            onClick={() => onClose()}
            className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 dark:bg-indigo-500 dark:hover:bg-indigo-400"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )

  return createPortal(sheet, document.body)
}
