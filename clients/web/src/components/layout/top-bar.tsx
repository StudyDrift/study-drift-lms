import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, LogOut, Menu, Search, User } from 'lucide-react'
import { Link, matchPath, useLocation, useNavigate } from 'react-router-dom'
import { setCourseViewAs, useCourseViewAs } from '../../lib/course-view-as'
import { authorizedFetch } from '../../lib/api'
import { useViewerEnrollmentRoles } from '../../lib/use-viewer-enrollment-roles'
import { useCommandPalette } from '../command-palette/use-command-palette'
import { useKeyboardShortcutsSheet } from '../keyboard-shortcuts/keyboard-shortcuts-context'
import {
  dismissSearchShortcutTip,
  isPostLoginShortcutTipPending,
  isSearchShortcutTipDismissedPermanently,
} from '../../lib/post-login-shortcut-tip'
import { clearAccessToken } from '../../lib/auth'
import { applyUiTheme } from '../../lib/ui-theme'
import {
  initialsFromName,
  profileName,
  shortcutHint,
  type TopBarAccountProfile,
} from './top-bar-utils'
import { useShellNav } from './shell-nav-context'
import { TopBarBreadcrumbs } from './top-bar-breadcrumbs'
import { NotificationsDrawer, NotificationsDrawerTrigger } from './notifications-drawer'

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
        className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white py-1.5 pl-1.5 pr-2.5 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:border-neutral-500 dark:hover:bg-neutral-700"
      >
        {profile?.avatarUrl ? (
          <img
            src={profile.avatarUrl}
            alt=""
            className="h-8 w-8 rounded-full border border-slate-200 object-cover dark:border-neutral-600"
          />
        ) : (
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700 dark:bg-neutral-700 dark:text-neutral-100">
            {initials}
          </span>
        )}
        <span className="hidden max-w-[10rem] truncate sm:inline">{name}</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-slate-500 transition dark:text-neutral-400 ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Account"
          className="absolute right-0 z-50 mt-1 min-w-[11rem] overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg shadow-slate-900/10 dark:border-neutral-600 dark:bg-neutral-800 dark:shadow-black/40"
        >
          <div className="border-b border-slate-100 px-3 py-2 dark:border-neutral-700">
            <p className="truncate text-sm font-medium text-slate-800 dark:text-neutral-100">{name}</p>
            {profile?.email && (
              <p className="truncate text-xs text-slate-500 dark:text-neutral-400">{profile.email}</p>
            )}
          </div>
          <Link
            to="/settings/account"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-slate-700 transition hover:bg-slate-50 dark:text-neutral-200 dark:hover:bg-neutral-700"
          >
            <User className="h-4 w-4 shrink-0 text-slate-500 dark:text-neutral-400" aria-hidden />
            Profile
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={signOut}
            className="flex w-full items-center gap-2 border-t border-slate-100 px-3 py-2.5 text-left text-sm text-slate-700 transition hover:bg-slate-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-700"
          >
            <LogOut className="h-4 w-4 shrink-0 text-slate-500 dark:text-neutral-400" aria-hidden />
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}

function CourseEnrollmentViewDropdown() {
  const location = useLocation()
  const courseCode = useMemo(() => {
    const m = matchPath({ path: '/courses/:courseCode', end: false }, location.pathname)
    return m?.params.courseCode ?? null
  }, [location.pathname])

  const courseViewMode = useCourseViewAs(courseCode ?? undefined)

  const viewerRoles = useViewerEnrollmentRoles(courseCode)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

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

  const hasTeacher = viewerRoles?.includes('teacher') ?? false
  const hasStudent = viewerRoles?.includes('student') ?? false
  const show = Boolean(courseCode && hasTeacher && hasStudent)

  if (!show || !courseCode) return null

  const label = courseViewMode === 'student' ? 'Student' : 'Teacher'

  return (
    <div ref={rootRef} className="relative shrink-0 text-left">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`View course as ${label}. Open menu to switch between teacher and student preview.`}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex max-w-full items-center gap-1.5 rounded-xl bg-indigo-600 px-2.5 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/30 dark:bg-neutral-100 dark:text-neutral-950 dark:hover:bg-white dark:focus-visible:ring-neutral-400/40 md:gap-2 md:px-4 md:py-2.5 md:text-sm"
      >
        <span className="max-md:sr-only">View as: </span>
        {label}
        <ChevronDown
          className={`h-4 w-4 shrink-0 transition ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="View course as"
          className="absolute right-0 z-50 mt-1 min-w-[14rem] overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg shadow-slate-900/10 dark:border-neutral-600 dark:bg-neutral-800 dark:shadow-black/40"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setCourseViewAs(courseCode, 'teacher')
              setOpen(false)
            }}
            className={`flex w-full flex-col gap-0.5 px-3 py-2.5 text-left text-sm transition hover:bg-slate-50 dark:hover:bg-neutral-700 ${
              courseViewMode === 'teacher' ? 'bg-indigo-50 dark:bg-neutral-800' : ''
            }`}
          >
            <span className="font-semibold text-slate-950 dark:text-neutral-100">Teacher</span>
            <span className="text-xs text-slate-500 dark:text-neutral-400">
              Manage course content, gradebook, and settings
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setCourseViewAs(courseCode, 'student')
              setOpen(false)
            }}
            className={`flex w-full flex-col gap-0.5 px-3 py-2.5 text-left text-sm transition hover:bg-slate-50 dark:hover:bg-neutral-700 ${
              courseViewMode === 'student' ? 'bg-indigo-50 dark:bg-neutral-800' : ''
            }`}
          >
            <span className="font-semibold text-slate-950 dark:text-neutral-100">Student</span>
            <span className="text-xs text-slate-500 dark:text-neutral-400">
              Preview the course as a learner would see it
            </span>
          </button>
        </div>
      )}
    </div>
  )
}

export function TopBar() {
  const { open } = useCommandPalette()
  const { openSheet } = useKeyboardShortcutsSheet()
  const { mobileNavOpen, setMobileNavOpen } = useShellNav()
  const [notificationsOpen, setNotificationsOpen] = useState(false)

  const searchAnchorRef = useRef<HTMLDivElement>(null)
  const [showShortcutTip, setShowShortcutTip] = useState(
    () => isPostLoginShortcutTipPending() && !isSearchShortcutTipDismissedPermanently(),
  )
  const [shortcutTipTop, setShortcutTipTop] = useState<number | null>(null)

  useLayoutEffect(() => {
    if (!showShortcutTip) {
      const cancelId = requestAnimationFrame(() => setShortcutTipTop(null))
      return () => cancelAnimationFrame(cancelId)
    }
    const measure = () => {
      if (!searchAnchorRef.current) {
        setShortcutTipTop(null)
        return
      }
      const r = searchAnchorRef.current.getBoundingClientRect()
      setShortcutTipTop(r.bottom + 10)
    }
    const frameId = requestAnimationFrame(measure)
    const el = searchAnchorRef.current
    const scheduleMeasure = () => requestAnimationFrame(measure)
    window.addEventListener('resize', scheduleMeasure)
    const ro = el ? new ResizeObserver(scheduleMeasure) : null
    if (el && ro) ro.observe(el)
    return () => {
      cancelAnimationFrame(frameId)
      window.removeEventListener('resize', scheduleMeasure)
      ro?.disconnect()
    }
  }, [showShortcutTip])

  function dismissShortcutTip() {
    dismissSearchShortcutTip()
    setShowShortcutTip(false)
    setShortcutTipTop(null)
  }

  const shortcutTipPortal =
    showShortcutTip && shortcutTipTop != null
      ? createPortal(
          <div
            className="fixed left-4 right-4 z-[95] mx-auto max-w-sm rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-lg shadow-slate-900/15 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:shadow-black/40"
            style={{ top: shortcutTipTop }}
            role="status"
          >
            <p className="font-medium text-slate-900 dark:text-neutral-100">Search from anywhere</p>
            <p className="mt-2 leading-relaxed text-slate-600 dark:text-neutral-300">
              Press <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-xs text-slate-700 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200">{shortcutHint()}</kbd>{' '}
              or use the search field. Press <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-xs text-slate-700 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200">?</kbd> for
              all shortcuts.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  openSheet()
                }}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
              >
                View shortcuts
              </button>
              <button
                type="button"
                onClick={dismissShortcutTip}
                className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 dark:bg-indigo-500 dark:hover:bg-indigo-400"
              >
                Got it
              </button>
            </div>
          </div>,
          document.body,
        )
      : null

  return (
    <header className="lms-chrome flex h-14 shrink-0 items-center gap-1.5 border-b border-slate-200 bg-white px-2 shadow-sm shadow-slate-900/5 print:hidden sm:gap-3 sm:px-4 md:gap-4 md:px-6 dark:border-neutral-700 dark:bg-neutral-900 dark:shadow-black/20">
      <button
        type="button"
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-600 transition hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/30 md:hidden dark:text-neutral-300 dark:hover:bg-neutral-800"
        aria-label={mobileNavOpen ? 'Close navigation menu' : 'Open navigation menu'}
        aria-expanded={mobileNavOpen}
        aria-controls="shell-nav"
        onClick={() => setMobileNavOpen((o) => !o)}
      >
        <Menu className="h-5 w-5" aria-hidden />
      </button>
      <div className="flex min-w-0 flex-1 items-center gap-2 md:gap-3">
        <TopBarBreadcrumbs />
        <div
          ref={searchAnchorRef}
          className="relative min-w-0 w-[min(100%,11rem)] shrink-0 sm:w-52 md:min-w-[12rem] md:max-w-xl md:flex-1"
        >
          <button
            type="button"
            aria-label="Search courses, people, pages, and actions"
            onClick={() => open()}
            className="flex w-full items-center gap-2 rounded-full border border-slate-200 bg-slate-100 py-2 pl-3 pr-4 text-left text-sm text-slate-500 outline-none transition hover:border-slate-300 hover:bg-slate-50 focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:border-neutral-500 dark:hover:bg-neutral-700 dark:focus:bg-neutral-800"
          >
            <Search className="h-4 w-4 shrink-0 text-slate-400 dark:text-neutral-500" aria-hidden />
            <span className="min-w-0 flex-1 truncate sm:hidden">Search…</span>
            <span className="hidden min-w-0 flex-1 truncate sm:inline">Search courses, people, pages…</span>
            <kbd className="pointer-events-none shrink-0 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-500 sm:px-2 sm:text-[11px] dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-400">
              {shortcutHint()}
            </kbd>
          </button>
        </div>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-3">
        <NotificationsDrawerTrigger open={notificationsOpen} onOpen={() => setNotificationsOpen(true)} />
        <CourseEnrollmentViewDropdown />
        <UserMenu />
      </div>
      <NotificationsDrawer open={notificationsOpen} onClose={() => setNotificationsOpen(false)} />
      {shortcutTipPortal}
    </header>
  )
}
