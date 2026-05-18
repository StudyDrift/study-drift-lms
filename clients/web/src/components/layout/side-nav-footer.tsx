import { NavLink } from 'react-router-dom'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { RELEASE_VERSION } from '../../lib/release-version'
import { useShellNav } from './use-shell-nav'

const linkClass =
  'text-slate-600 underline decoration-slate-300 underline-offset-2 transition hover:text-slate-900 hover:decoration-slate-500 dark:text-neutral-400 dark:decoration-neutral-600 dark:hover:text-neutral-100 dark:hover:decoration-neutral-400'

function versionLabel(version: string) {
  const trimmed = version.trim()
  if (!trimmed) return 'v0'
  return trimmed.startsWith('v') ? trimmed : `v${trimmed}`
}

export function SideNavFooter() {
  const { sideNavCollapsed, toggleSideNav } = useShellNav()
  const year = new Date().getFullYear()

  return (
    <footer
      className={`shrink-0 border-t border-slate-200/80 px-3 py-2.5 text-[11px] leading-snug text-slate-500 dark:border-neutral-800 dark:text-neutral-500 ${
        sideNavCollapsed ? 'flex justify-center' : ''
      }`}
    >
      <button
        type="button"
        onClick={toggleSideNav}
        className={`mb-2 flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-sm font-medium text-slate-500 transition-colors hover:bg-white/80 hover:text-slate-900 dark:text-neutral-400 dark:hover:bg-neutral-800/90 dark:hover:text-neutral-50 ${
          sideNavCollapsed ? 'justify-center' : ''
        }`}
        title={sideNavCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {sideNavCollapsed ? (
          <PanelLeftOpen className="h-5 w-5 shrink-0" />
        ) : (
          <>
            <PanelLeftClose className="h-5 w-5 shrink-0" />
            <span>Collapse</span>
          </>
        )}
      </button>

      {!sideNavCollapsed && (
        <>
          <p className="flex min-w-0 items-baseline justify-between gap-2 text-slate-600 dark:text-neutral-400">
            <span className="min-w-0 shrink">© {year} Lextures</span>
            <span
              className="shrink-0 text-slate-500 tabular-nums dark:text-neutral-500"
              title="App version"
            >
              {versionLabel(RELEASE_VERSION)}
            </span>
          </p>
          <p className="mt-1">
            <NavLink to="/terms" className={linkClass}>
              Terms of use
            </NavLink>
            <span className="mx-1 text-slate-400 dark:text-neutral-600" aria-hidden="true">
              ·
            </span>
            <NavLink to="/privacy" className={linkClass}>
              Privacy policy
            </NavLink>
          </p>
        </>
      )}
    </footer>
  )
}
