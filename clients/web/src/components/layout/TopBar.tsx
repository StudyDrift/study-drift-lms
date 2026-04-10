import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown, LogOut, Search, User } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useCommandPalette } from '../command-palette/useCommandPalette'
import { clearAccessToken } from '../../lib/auth'
import { authorizedFetch } from '../../lib/api'
import { applyUiTheme } from '../../lib/uiTheme'
import {
  initialsFromName,
  profileName,
  shortcutHint,
  type TopBarAccountProfile,
} from './topBarUtils'

function UserMenu() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [profile, setProfile] = useState<TopBarAccountProfile | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  useEffect(() => {
    let cancelled = false
    async function loadProfile() {
      try {
        const res = await authorizedFetch('/api/v1/settings/account')
        const raw: unknown = await res.json().catch(() => ({}))
        if (!res.ok || cancelled) return
        const data = raw as TopBarAccountProfile
        setProfile(data)
      } catch {
        if (!cancelled) setProfile(null)
      }
    }
    void loadProfile()
    function onProfileUpdated() {
      void loadProfile()
    }
    window.addEventListener('studydrift-profile-updated', onProfileUpdated)
    return () => {
      cancelled = true
      window.removeEventListener('studydrift-profile-updated', onProfileUpdated)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function signOut() {
    setOpen(false)
    clearAccessToken()
    applyUiTheme('light')
    navigate('/login', { replace: true })
  }

  const name = profileName(profile)
  const initials = initialsFromName(name)

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label="User menu"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white py-1.5 pl-1.5 pr-2.5 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:bg-slate-700/80"
      >
        {profile?.avatarUrl ? (
          <img
            src={profile.avatarUrl}
            alt=""
            className="h-8 w-8 rounded-full border border-slate-200 object-cover dark:border-slate-600"
          />
        ) : (
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700 dark:bg-indigo-950/80 dark:text-indigo-300">
            {initials}
          </span>
        )}
        <span className="hidden max-w-[10rem] truncate sm:inline">{name}</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-slate-500 transition dark:text-slate-400 ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Account"
          className="absolute right-0 z-50 mt-1 min-w-[11rem] overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg shadow-slate-900/10 dark:border-slate-600 dark:bg-slate-800 dark:shadow-black/40"
        >
          <div className="border-b border-slate-100 px-3 py-2 dark:border-slate-700">
            <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{name}</p>
            {profile?.email && (
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">{profile.email}</p>
            )}
          </div>
          <Link
            to="/settings/account"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-slate-700 transition hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700/80"
          >
            <User className="h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" aria-hidden />
            Profile
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={signOut}
            className="flex w-full items-center gap-2 border-t border-slate-100 px-3 py-2.5 text-left text-sm text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700/80"
          >
            <LogOut className="h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" aria-hidden />
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}

export function TopBar() {
  const { open } = useCommandPalette()

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-slate-200 bg-white px-4 shadow-sm shadow-slate-900/5 md:px-6 dark:border-slate-700 dark:bg-slate-900 dark:shadow-black/20">
      <div className="relative min-w-0 flex-1 max-w-xl">
        <button
          type="button"
          onClick={() => open()}
          className="flex w-full items-center gap-2 rounded-full border border-slate-200 bg-slate-100 py-2 pl-3 pr-4 text-left text-sm text-slate-500 outline-none transition hover:border-slate-300 hover:bg-slate-50 focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-500 dark:hover:bg-slate-700/50 dark:focus:bg-slate-800"
        >
          <Search className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden />
          <span className="min-w-0 flex-1 truncate">Search courses, people, pages…</span>
          <kbd className="hidden shrink-0 rounded-md border border-slate-200 bg-white px-2 py-0.5 font-mono text-[11px] text-slate-500 sm:inline dark:border-slate-600 dark:bg-slate-900 dark:text-slate-400">
            {shortcutHint()}
          </kbd>
        </button>
      </div>
      <div className="ml-auto shrink-0">
        <UserMenu />
      </div>
    </header>
  )
}
