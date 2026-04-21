import { BookOpen, PanelLeft } from 'lucide-react'
import { useReadingShellFocus } from './reading-shell-focus-context'

export function ReadingFocusTopBar() {
  const { setReadingFocus } = useReadingShellFocus()
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-3 shadow-sm print:hidden sm:px-5 dark:border-neutral-700 dark:bg-neutral-900">
      <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-slate-700 dark:text-neutral-200">
        <BookOpen className="h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-400" aria-hidden />
        <span className="truncate">Reading focus</span>
      </div>
      <button
        type="button"
        onClick={() => setReadingFocus(false)}
        className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
      >
        <PanelLeft className="h-4 w-4" aria-hidden />
        Show navigation
      </button>
    </header>
  )
}
