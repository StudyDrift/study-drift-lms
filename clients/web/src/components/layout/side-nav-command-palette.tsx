import { Search } from 'lucide-react'
import { useCommandPalette } from '../command-palette/use-command-palette'
import { shortcutHint } from './top-bar-utils'
import { useShellNav } from './use-shell-nav'
import { SideNavTooltip } from './side-nav-tooltip'

/** Full-width capsule trigger below the sidebar header (desktop + mobile drawer). */
export function SideNavCommandPaletteTrigger() {
  const { open } = useCommandPalette()
  const { sideNavCollapsed } = useShellNav()

  return (
    <div className={`shrink-0 pb-3 pt-0.5 ${sideNavCollapsed ? 'px-3' : 'px-3'}`}>
      <SideNavTooltip content="Search">
        <button
          type="button"
          role="searchbox"
          aria-label="Search courses, people, pages, and actions"
          data-command-palette-anchor="sidebar"
          data-onboarding="command-palette"
          onClick={() => open()}
          className={`flex items-center rounded-full bg-[#E8E9EB] text-left text-sm text-slate-500 outline-none transition hover:bg-[#E0E2E5] focus-visible:ring-2 focus-visible:ring-slate-400/35 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:focus-visible:ring-neutral-500/40 ${
            sideNavCollapsed ? 'h-10 w-10 justify-center p-0 mx-auto' : 'w-full gap-2.5 py-2 pl-3 pr-2'
          }`}
          title={undefined}
        >
        <Search
          className={`h-4 w-4 shrink-0 text-slate-400 dark:text-neutral-500 ${
            sideNavCollapsed ? 'h-5 w-5' : ''
          }`}
          strokeWidth={1.75}
          aria-hidden
        />
        {!sideNavCollapsed && (
          <>
            <span className="min-w-0 flex-1 truncate font-medium text-slate-500 dark:text-neutral-400">
              Search
            </span>
            <kbd className="pointer-events-none flex h-7 min-w-[1.75rem] shrink-0 items-center justify-center rounded-lg border border-black/[0.06] bg-white px-2 font-mono text-[11px] font-medium text-slate-500 shadow-sm dark:border-white/10 dark:bg-neutral-900 dark:text-neutral-400">
              {shortcutHint()}
            </kbd>
          </>
        )}
      </button>
    </SideNavTooltip>
    </div>
  )
}

/** Icon-only trigger when the sidebar is hidden (narrow viewports). */
export function TopBarMobileCommandPaletteButton() {
  const { open } = useCommandPalette()
  return (
    <button
      type="button"
      aria-label="Search courses, people, pages, and actions"
      data-command-palette-anchor="topbar"
      onClick={() => open()}
      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-600 transition hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/35 md:hidden dark:text-neutral-300 dark:hover:bg-neutral-800 dark:focus-visible:ring-neutral-500/40"
    >
      <Search className="h-5 w-5" strokeWidth={1.75} aria-hidden />
    </button>
  )
}
