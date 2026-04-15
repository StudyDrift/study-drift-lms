import { useEffect, useId, useRef, useState } from 'react'
import {
  ChevronDown,
  CircleHelp,
  ClipboardList,
  ExternalLink,
  FileText,
  Heading,
  Plus,
} from 'lucide-react'

export type ModuleItemKind =
  | 'heading'
  | 'content_page'
  | 'assignment'
  | 'quiz'
  | 'external_link'

type AddModuleItemMenuProps = {
  onAdd: (kind: ModuleItemKind) => void
  disabled?: boolean
}

export function AddModuleItemMenu({ onAdd, disabled }: AddModuleItemMenuProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  function pick(kind: ModuleItemKind) {
    onAdd(kind)
    setOpen(false)
  }

  return (
    <div ref={rootRef} className="relative inline-block max-w-full text-left">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          if (disabled) return
          setOpen((o) => !o)
        }}
        className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-slate-200/70 bg-white/90 px-2 py-1.5 text-xs font-medium text-slate-700 shadow-none transition hover:border-slate-300/80 hover:bg-slate-50/90 disabled:cursor-not-allowed disabled:opacity-60 sm:px-2.5 sm:text-sm dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:border-neutral-500 dark:hover:bg-neutral-800"
      >
        <Plus className="h-4 w-4 shrink-0" aria-hidden />
        <span className="truncate sm:hidden">Add item</span>
        <span className="hidden truncate sm:inline">Add module item</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 transition ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Module item types"
          className="absolute right-0 z-50 mt-1 w-max min-w-[min(22rem,calc(100vw-1.5rem))] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg shadow-slate-900/10 dark:border-neutral-600 dark:bg-neutral-800 dark:shadow-black/40"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => pick('heading')}
            className="flex w-full items-start gap-3 px-3 py-2.5 text-left text-sm transition hover:bg-slate-50 dark:hover:bg-neutral-700"
          >
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-400">
              <Heading className="h-4 w-4" aria-hidden />
            </span>
            <span className="min-w-0 flex flex-col gap-0.5">
              <span className="font-semibold text-slate-950 dark:text-neutral-100">Heading</span>
              <span className="text-xs text-slate-500 dark:text-neutral-400">Text label for organizing content</span>
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => pick('content_page')}
            className="flex w-full items-start gap-3 border-t border-slate-100 px-3 py-2.5 text-left text-sm transition hover:bg-slate-50 dark:border-neutral-700 dark:hover:bg-neutral-700"
          >
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-indigo-200/80 bg-indigo-50 text-indigo-600 dark:border-indigo-500/35 dark:bg-indigo-950 dark:text-indigo-300">
              <FileText className="h-4 w-4" aria-hidden />
            </span>
            <span className="min-w-0 flex flex-col gap-0.5">
              <span className="font-semibold text-slate-950 dark:text-neutral-100">Content page</span>
              <span className="text-xs text-slate-500 dark:text-neutral-400">Markdown page with rich formatting</span>
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => pick('assignment')}
            className="flex w-full items-start gap-3 border-t border-slate-100 px-3 py-2.5 text-left text-sm transition hover:bg-slate-50 dark:border-neutral-700 dark:hover:bg-neutral-700"
          >
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-amber-200/90 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-950 dark:text-amber-200">
              <ClipboardList className="h-4 w-4" aria-hidden />
            </span>
            <span className="min-w-0 flex flex-col gap-0.5">
              <span className="font-semibold text-slate-950 dark:text-neutral-100">Assignment</span>
              <span className="text-xs text-slate-500 dark:text-neutral-400">Graded or submitted work</span>
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => pick('quiz')}
            className="flex w-full items-start gap-3 border-t border-slate-100 px-3 py-2.5 text-left text-sm transition hover:bg-slate-50 dark:border-neutral-700 dark:hover:bg-neutral-700"
          >
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-emerald-200/90 bg-emerald-50 text-emerald-700 dark:border-emerald-500/35 dark:bg-emerald-950 dark:text-emerald-200">
              <CircleHelp className="h-4 w-4" aria-hidden />
            </span>
            <span className="min-w-0 flex flex-col gap-0.5">
              <span className="font-semibold text-slate-950 dark:text-neutral-100">Quiz</span>
              <span className="text-xs text-slate-500 dark:text-neutral-400">
                Questions and auto-graded checks
              </span>
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => pick('external_link')}
            className="flex w-full items-start gap-3 border-t border-slate-100 px-3 py-2.5 text-left text-sm transition hover:bg-slate-50 dark:border-neutral-700 dark:hover:bg-neutral-700"
          >
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-violet-200/90 bg-violet-50 text-violet-700 dark:border-violet-500/40 dark:bg-violet-950 dark:text-violet-200">
              <ExternalLink className="h-4 w-4" aria-hidden />
            </span>
            <span className="min-w-0 flex flex-col gap-0.5">
              <span className="font-semibold text-slate-950 dark:text-neutral-100">External link</span>
              <span className="text-xs text-slate-500 dark:text-neutral-400">
                Opens a URL in a new tab
              </span>
            </span>
          </button>
        </div>
      )}
    </div>
  )
}
