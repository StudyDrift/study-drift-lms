import { matchPath, NavLink, useLocation } from 'react-router-dom'
import { BrandLogo } from '../BrandLogo'
import { SideNavCourseLinks } from './SideNavCourseLinks'
import { SideNavCourseSettingsLinks } from './SideNavCourseSettingsLinks'
import { SideNavMainLinks } from './SideNavMainLinks'
import { SideNavSettingsLinks } from './SideNavSettingsLinks'

export function SideNav() {
  const location = useLocation()
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
    <aside className="flex h-screen w-60 shrink-0 flex-col border-r border-slate-200 bg-[#F8F9FA] text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
      <div className="border-b border-slate-200 px-4 py-5 dark:border-slate-700">
        <NavLink
          to="/"
          className="flex items-center gap-3 rounded-xl outline-none ring-indigo-500/40 focus-visible:ring-2"
          end
        >
          <BrandLogo className="mx-0 h-9 w-auto shrink-0 object-contain object-left drop-shadow-sm" />
          <span className="truncate text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Lextures
          </span>
        </NavLink>
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <nav
          className={`absolute inset-0 flex flex-col gap-0.5 overflow-y-auto p-3 transition-all duration-300 ease-out ${
            showMainNav
              ? 'z-10 translate-y-0 opacity-100'
              : 'pointer-events-none z-0 -translate-y-1 opacity-0'
          }`}
          aria-label="Main"
          inert={!showMainNav}
        >
          <SideNavMainLinks />
        </nav>
        <nav
          className={`sidenav-course-items absolute inset-0 flex flex-col gap-0.5 overflow-y-auto p-3 transition-all duration-300 ease-out ${
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
          className={`absolute inset-0 flex flex-col gap-0.5 overflow-y-auto p-3 transition-all duration-300 ease-out ${
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
          className={`absolute inset-0 flex flex-col gap-0.5 overflow-y-auto p-3 transition-all duration-300 ease-out ${
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
    </aside>
  )
}
