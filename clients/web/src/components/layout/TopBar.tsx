import { Search } from 'lucide-react'
import { useCommandPalette } from '../command-palette/useCommandPalette'

function shortcutHint(): string {
  if (typeof navigator === 'undefined') return '⌘K'
  const p = navigator.platform ?? ''
  const ua = navigator.userAgent ?? ''
  const apple = /Mac|iPhone|iPad|iPod/.test(p) || /Mac OS/.test(ua)
  return apple ? '⌘K' : 'Ctrl+K'
}

export function TopBar() {
  const { open } = useCommandPalette()

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-slate-200 bg-white px-4 shadow-sm shadow-slate-900/5 md:px-6">
      <div className="relative min-w-0 flex-1 max-w-xl">
        <button
          type="button"
          onClick={() => open()}
          className="flex w-full items-center gap-2 rounded-full border border-slate-200 bg-slate-100 py-2 pl-3 pr-4 text-left text-sm text-slate-500 outline-none transition hover:border-slate-300 hover:bg-slate-50 focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-500/20"
        >
          <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
          <span className="min-w-0 flex-1 truncate">Search courses, people, pages…</span>
          <kbd className="hidden shrink-0 rounded-md border border-slate-200 bg-white px-2 py-0.5 font-mono text-[11px] text-slate-500 sm:inline">
            {shortcutHint()}
          </kbd>
        </button>
      </div>
    </header>
  )
}
