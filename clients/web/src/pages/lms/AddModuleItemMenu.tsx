import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown, CircleHelp, ClipboardList, FileText, Heading, Plus } from 'lucide-react'

export type ModuleItemKind = 'heading' | 'content_page' | 'assignment' | 'quiz'

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
    <div ref={rootRef} className="relative inline-block text-left">
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
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:bg-slate-800"
      >
        <Plus className="h-4 w-4" aria-hidden />
        Add module item
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
          className="absolute right-0 z-50 mt-1 min-w-[12rem] overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg shadow-slate-900/10 dark:border-slate-600 dark:bg-slate-800 dark:shadow-black/40"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => pick('heading')}
            className="flex w-full items-start gap-3 px-3 py-2.5 text-left text-sm transition hover:bg-slate-50 dark:hover:bg-slate-700/80"
          >
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-400">
              <Heading className="h-4 w-4" aria-hidden />
            </span>
            <span className="min-w-0 flex flex-col gap-0.5">
              <span className="font-semibold text-slate-950 dark:text-slate-100">Heading</span>
              <span className="text-xs text-slate-500 dark:text-slate-400">Text label for organizing content</span>
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => pick('content_page')}
            className="flex w-full items-start gap-3 border-t border-slate-100 px-3 py-2.5 text-left text-sm transition hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-700/80"
          >
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-indigo-200/80 bg-indigo-50 text-indigo-600 dark:border-indigo-500/35 dark:bg-indigo-950/60 dark:text-indigo-300">
              <FileText className="h-4 w-4" aria-hidden />
            </span>
            <span className="min-w-0 flex flex-col gap-0.5">
              <span className="font-semibold text-slate-950 dark:text-slate-100">Content page</span>
              <span className="text-xs text-slate-500 dark:text-slate-400">Markdown page with rich formatting</span>
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => pick('assignment')}
            className="flex w-full items-start gap-3 border-t border-slate-100 px-3 py-2.5 text-left text-sm transition hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-700/80"
          >
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-amber-200/90 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-950/50 dark:text-amber-200">
              <ClipboardList className="h-4 w-4" aria-hidden />
            </span>
            <span className="min-w-0 flex flex-col gap-0.5">
              <span className="font-semibold text-slate-950 dark:text-slate-100">Assignment</span>
              <span className="text-xs text-slate-500 dark:text-slate-400">Graded or submitted work</span>
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => pick('quiz')}
            className="flex w-full items-start gap-3 border-t border-slate-100 px-3 py-2.5 text-left text-sm transition hover:bg-slate-50"
          >
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-emerald-200/90 bg-emerald-50 text-emerald-700">
              <CircleHelp className="h-4 w-4" aria-hidden />
            </span>
            <span className="min-w-0 flex flex-col gap-0.5">
              <span className="font-semibold text-slate-900">Quiz</span>
              <span className="text-xs text-slate-500">Questions and auto-graded checks</span>
            </span>
          </button>
        </div>
      )}
    </div>
  )
}
