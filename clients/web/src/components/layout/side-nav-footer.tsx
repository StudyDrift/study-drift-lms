import { NavLink } from 'react-router-dom'
import { RELEASE_VERSION } from '../../lib/release-version'

const linkClass =
  'text-slate-600 underline decoration-slate-300 underline-offset-2 transition hover:text-slate-900 hover:decoration-slate-500 dark:text-neutral-400 dark:decoration-neutral-600 dark:hover:text-neutral-100 dark:hover:decoration-neutral-400'

function versionLabel(version: string) {
  const trimmed = version.trim()
  if (!trimmed) return 'v0'
  return trimmed.startsWith('v') ? trimmed : `v${trimmed}`
}

export function SideNavFooter() {
  const year = new Date().getFullYear()

  return (
    <footer className="shrink-0 border-t border-slate-200 px-3 py-2.5 text-[11px] leading-snug text-slate-500 dark:border-neutral-800 dark:text-neutral-500">
      <p className="flex min-w-0 items-baseline justify-between gap-2 text-slate-600 dark:text-neutral-400">
        <span className="min-w-0 shrink">© {year} Lextures</span>
        <span className="shrink-0 text-slate-500 tabular-nums dark:text-neutral-500" title="App version">
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
    </footer>
  )
}
