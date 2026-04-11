import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown, Plus } from 'lucide-react'

type AddCourseItemMenuProps = {
  onAdd: () => void
  disabled?: boolean
}

export function AddCourseItemMenu({ onAdd, disabled }: AddCourseItemMenuProps) {
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

  return (
    <div ref={rootRef} className="relative block w-full text-left sm:inline-block sm:w-auto">
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
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-3 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:justify-start sm:px-4"
      >
        <Plus className="h-4 w-4 shrink-0" aria-hidden />
        <span className="sm:hidden">Add module</span>
        <span className="hidden sm:inline">Add Course Item</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 transition ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Course item types"
          className="absolute left-0 right-0 z-50 mt-1 min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg shadow-slate-900/10 sm:left-auto sm:right-0 sm:min-w-[14rem] dark:border-neutral-600 dark:bg-neutral-800 dark:shadow-black/40"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onAdd()
              setOpen(false)
            }}
            className="flex w-full flex-col gap-0.5 px-3 py-2.5 text-left text-sm transition hover:bg-slate-50 dark:hover:bg-neutral-700/80"
          >
            <span className="font-semibold text-slate-950 dark:text-neutral-100">Module</span>
            <span className="text-xs text-slate-500 dark:text-neutral-400">Group course activities and items</span>
          </button>
        </div>
      )}
    </div>
  )
}
