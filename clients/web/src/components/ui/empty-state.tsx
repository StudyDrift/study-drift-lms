import type { LucideIcon } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

export type EmptyStateAction =
  | { label: string; to: string }
  | { label: string; onClick: () => void }

export type EmptyStateProps = {
  icon: LucideIcon
  title: string
  body?: ReactNode
  primaryAction?: EmptyStateAction
  secondaryAction?: EmptyStateAction
  className?: string
}

function ActionButton({ action, variant }: { action: EmptyStateAction; variant: 'primary' | 'secondary' }) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-neutral-950'
  if ('to' in action) {
    return (
      <Link
        to={action.to}
        className={
          variant === 'primary'
            ? `${base} bg-indigo-600 text-white hover:bg-indigo-500`
            : `${base} border border-slate-200 bg-white text-slate-800 hover:bg-slate-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800`
        }
      >
        {action.label}
      </Link>
    )
  }
  return (
    <button
      type="button"
      onClick={action.onClick}
      className={
        variant === 'primary'
          ? `${base} bg-indigo-600 text-white hover:bg-indigo-500`
          : `${base} border border-slate-200 bg-white text-slate-800 hover:bg-slate-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800`
      }
    >
      {action.label}
    </button>
  )
}

export function EmptyState({ icon: Icon, title, body, primaryAction, secondaryAction, className = '' }: EmptyStateProps) {
  const titleId = useId()
  return (
    <section
      className={`rounded-2xl border border-slate-200/90 bg-slate-50/80 px-6 py-12 shadow-sm dark:border-neutral-700 dark:bg-neutral-900/40 ${className}`}
      role="status"
      aria-labelledby={titleId}
    >
      <div className="mx-auto flex max-w-md flex-col items-center text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-slate-400 shadow-sm ring-1 ring-slate-200/80 dark:bg-neutral-950 dark:text-neutral-500 dark:ring-neutral-700">
          <Icon className="h-6 w-6 shrink-0" aria-hidden />
        </span>
        <h2
          id={titleId}
          className="mt-4 text-base font-semibold tracking-tight text-slate-900 dark:text-neutral-50"
        >
          {title}
        </h2>
        {body != null && body !== false ? (
          <div className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-neutral-400">{body}</div>
        ) : null}
        {(primaryAction || secondaryAction) && (
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            {primaryAction ? <ActionButton action={primaryAction} variant="primary" /> : null}
            {secondaryAction ? <ActionButton action={secondaryAction} variant="secondary" /> : null}
          </div>
        )}
      </div>
    </section>
  )
}
