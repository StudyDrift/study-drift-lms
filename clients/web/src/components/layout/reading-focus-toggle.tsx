import { BookOpen } from 'lucide-react'
import { useReadingShellFocus } from './reading-shell-focus-context'

/** Hides the course shell side nav for long-form reading (exit from the slim top bar). */
export function ReadingFocusToggle() {
  const { readingFocus, setReadingFocus } = useReadingShellFocus()
  if (readingFocus) return null
  return (
    <button
      type="button"
      onClick={() => setReadingFocus(true)}
      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
    >
      <BookOpen className="h-4 w-4 text-indigo-600 dark:text-indigo-400" aria-hidden />
      Reading focus
    </button>
  )
}
