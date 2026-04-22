import { useEffect } from 'react'
import { matchPath, NavLink, useLocation } from 'react-router-dom'
import { BrandLogo } from '../brand-logo'
import { useShellNav } from './use-shell-nav'
import { SideNavCourseLinks } from './side-nav-course-links'
import { SideNavCourseSettingsLinks } from './side-nav-course-settings-links'
import { SideNavMainLinks } from './side-nav-main-links'
import { SideNavFooter } from './side-nav-footer'
import { SideNavSettingsLinks } from './side-nav-settings-links'
import { SideNavCommandPaletteTrigger } from './side-nav-command-palette'

export function SideNav() {
  const { mobileNavOpen, closeMobileNav } = useShellNav()
  const location = useLocation()

  useEffect(() => {
    closeMobileNav()
  }, [location.pathname, closeMobileNav])

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(min-width: 768px)')
    function onChange() {
      if (mq.matches) closeMobileNav()
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [closeMobileNav])

  useEffect(() => {
    if (!mobileNavOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closeMobileNav()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mobileNavOpen, closeMobileNav])

  useEffect(() => {
    if (!mobileNavOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [mobileNavOpen])
  const courseMatch = matchPath({ path: '/courses/:courseCode', end: false }, location.pathname)
  const courseCode = courseMatch?.params.courseCode
  const courseSettingsMatch = matchPath(
    { path: '/courses/:courseCode/settings', end: false },
    location.pathname,
  )
  const isCourseSettingsNav = Boolean(courseSettingsMatch)
  const isCourseNav = Boolean(courseCode)
  const isSettingsNav = location.pathname.startsWith('/settings')

  const showMainNav = !isCourseNav && !isSettingsNav
  const showCourseNav = isCourseNav && !isCourseSettingsNav
  const showCourseSettingsNav = isCourseSettingsNav
  const showSettingsNav = isSettingsNav

  return (
    <>
      {mobileNavOpen ? (
        <button
          type="button"
          aria-label="Close navigation menu"
          className="lms-chrome fixed inset-0 z-30 bg-slate-900/45 backdrop-blur-[1px] print:hidden md:hidden"
          onClick={closeMobileNav}
        />
      ) : null}
      <aside
        id="shell-nav"
        data-onboarding="side-nav"
        className={`lms-chrome flex h-dvh min-h-0 w-[min(17.5rem,88vw)] max-w-[280px] flex-col border-r border-slate-200/70 bg-[#F2F2F2] text-slate-900 print:hidden dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100 md:h-screen md:w-60 md:max-w-none md:shrink-0 md:translate-x-0 ${
          mobileNavOpen ? 'max-md:translate-x-0' : 'max-md:-translate-x-full'
        } max-md:fixed max-md:left-0 max-md:top-0 max-md:z-40 max-md:shadow-2xl max-md:transition-transform max-md:duration-200 max-md:ease-out max-md:pt-[env(safe-area-inset-top)] max-md:pb-[env(safe-area-inset-bottom)]`}
      >
        <div className="flex shrink-0 items-center px-3 pb-1 pt-3 md:px-3 md:pb-2 md:pt-4">
          <NavLink
            to="/"
            className="flex min-h-0 min-w-0 flex-1 items-center gap-3 rounded-2xl p-1 pr-2 outline-none ring-slate-400/30 transition hover:bg-white/50 focus-visible:ring-2 dark:ring-neutral-500/40 dark:hover:bg-white/5"
            end
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-slate-900/[0.06] dark:bg-neutral-800 dark:ring-white/10">
              <BrandLogo className="mx-0 h-7 w-auto shrink-0 object-contain object-left" />
            </span>
            <span className="truncate text-[1.05rem] font-semibold tracking-tight text-slate-950 dark:text-neutral-100">
              Lextures
            </span>
          </NavLink>
        </div>
        <SideNavCommandPaletteTrigger />
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          <nav
            className={`absolute inset-0 flex flex-col gap-1 overflow-y-auto px-3 pb-3 pt-0 transition-all duration-300 ease-out ${
              showMainNav
                ? 'z-10 translate-y-0 opacity-100'
                : 'pointer-events-none z-0 translate-y-1 opacity-0'
            }`}
            aria-label="Main"
            inert={!showMainNav}
          >
            <SideNavMainLinks />
          </nav>
          <nav
            className={`sidenav-course-items absolute inset-0 flex flex-col gap-1 overflow-y-auto px-3 pb-3 pt-0 transition-all duration-300 ease-out ${
              showCourseNav
                ? 'z-10 translate-y-0 opacity-100'
                : 'pointer-events-none z-0 translate-y-1 opacity-0'
            }`}
            aria-label="Course menu"
            inert={!showCourseNav}
          >
            {courseCode && <SideNavCourseLinks key={courseCode} courseCode={courseCode} />}
          </nav>
          <nav
            className={`absolute inset-0 flex flex-col gap-1 overflow-y-auto px-3 pb-3 pt-0 transition-all duration-300 ease-out ${
              showCourseSettingsNav
                ? 'z-10 translate-y-0 opacity-100'
                : 'pointer-events-none z-0 translate-y-1 opacity-0'
            }`}
            aria-label="Course settings menu"
            inert={!showCourseSettingsNav}
          >
            {courseSettingsMatch?.params.courseCode && (
              <SideNavCourseSettingsLinks
                key={courseSettingsMatch.params.courseCode}
                courseCode={courseSettingsMatch.params.courseCode}
              />
            )}
          </nav>
          <nav
            className={`absolute inset-0 flex flex-col gap-1 overflow-y-auto px-3 pb-3 pt-0 transition-all duration-300 ease-out ${
              showSettingsNav
                ? 'z-10 translate-y-0 opacity-100'
                : 'pointer-events-none z-0 translate-y-1 opacity-0'
            }`}
            aria-label="Settings menu"
            inert={!showSettingsNav}
          >
            {showSettingsNav && <SideNavSettingsLinks />}
          </nav>
        </div>
        <SideNavFooter />
      </aside>
    </>
  )
}
