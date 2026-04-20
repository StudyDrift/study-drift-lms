import { ChevronDown, ChevronUp, GripVertical, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'

export type BlockFloatingToolbarProps = {
  /** e.g. block type icon */
  icon: ReactNode
  /** Shown next to the icon (block type name). */
  label: string
  onMoveUp?: () => void
  onMoveDown?: () => void
  moveUpDisabled?: boolean
  moveDownDisabled?: boolean
  onRemove?: () => void
  removeLabel?: string
  disabled?: boolean
  /** Extra controls (e.g. formatting) before remove. */
  children?: ReactNode
}

/**
 * Compact horizontal toolbar that sits above the active block (Gutenberg-style).
 */
export function BlockFloatingToolbar({
  icon,
  label,
  onMoveUp,
  onMoveDown,
  moveUpDisabled,
  moveDownDisabled,
  onRemove,
  removeLabel = 'Remove block',
  disabled,
  children,
}: BlockFloatingToolbarProps) {
  return (
    <div
      data-toolbar-anchor
      className="pointer-events-auto flex h-9 max-w-[min(100vw-2rem,520px)] flex-wrap items-center gap-0.5 rounded-md border border-slate-200 bg-white px-1 py-0.5 shadow-md shadow-slate-900/10 dark:border-neutral-600 dark:bg-neutral-800 dark:shadow-black/40 sm:max-w-none sm:flex-nowrap"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      role="toolbar"
      aria-label={`${label} block tools`}
    >
      <span
        className="flex h-7 max-w-[148px] items-center gap-1 rounded px-1.5 text-slate-600 dark:text-neutral-300 sm:max-w-[200px]"
        title={label}
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center text-slate-500 dark:text-neutral-400" aria-hidden>
          {icon}
        </span>
        <span className="truncate text-xs font-medium text-slate-700 dark:text-neutral-200">{label}</span>
      </span>
      <span className="mx-0.5 h-5 w-px shrink-0 bg-slate-200 dark:bg-neutral-600" aria-hidden />
      <span
        className="flex h-7 w-7 shrink-0 cursor-grab items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600 active:cursor-grabbing dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
        aria-hidden
      >
        <GripVertical className="h-4 w-4" />
      </span>
      {onMoveUp && (
        <button
          type="button"
          disabled={disabled || moveUpDisabled}
          onClick={onMoveUp}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-neutral-300 dark:hover:bg-neutral-700"
          aria-label="Move block up"
        >
          <ChevronUp className="h-4 w-4" />
        </button>
      )}
      {onMoveDown && (
        <button
          type="button"
          disabled={disabled || moveDownDisabled}
          onClick={onMoveDown}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-neutral-300 dark:hover:bg-neutral-700"
          aria-label="Move block down"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      )}
      {children}
      {onRemove && (
        <button
          type="button"
          disabled={disabled}
          onClick={onRemove}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-40 dark:text-neutral-400 dark:hover:bg-rose-950/50 dark:hover:text-rose-400"
          aria-label={removeLabel}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}
