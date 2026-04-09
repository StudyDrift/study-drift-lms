import { matchPath, NavLink, useLocation } from 'react-router-dom'
import {
  ArrowLeft,
  BarChart3,
  Bell,
  BookOpen,
  Bot,
  Calendar,
  ClipboardList,
  FileText,
  Inbox,
  Info,
  Layers,
  LayoutDashboard,
  Palette,
  Scale,
  Settings,
  Shield,
  User,
  Users,
} from 'lucide-react'
import { useInboxUnreadCount } from '../../context/useInboxUnread'
import { usePermissions } from '../../context/usePermissions'
import { courseGradebookViewPermission } from '../../lib/coursesApi'
import { PERM_REPORTS_VIEW } from '../../lib/rbacApi'
import { BrandLogo } from '../BrandLogo'

const linkClass =
  'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-white hover:text-slate-900 hover:shadow-sm dark:text-slate-300 dark:hover:bg-slate-800/80 dark:hover:text-slate-50'

const activeClass =
  'bg-indigo-50 text-indigo-700 shadow-sm dark:bg-indigo-950/60 dark:text-indigo-300'

function MainNavLinks() {
  const unreadInboxCount = useInboxUnreadCount()
  const { allows, loading: permLoading } = usePermissions()
  const canViewReports = !permLoading && allows(PERM_REPORTS_VIEW)

  return (
    <>
      <NavLink
        to="/"
        end
        className={({ isActive }) => `${linkClass} ${isActive ? activeClass : ''}`}
      >
        <LayoutDashboard className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
        Dashboard
      </NavLink>
      <NavLink
        to="/courses"
        className={({ isActive }) => `${linkClass} ${isActive ? activeClass : ''}`}
      >
        <BookOpen className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
        Courses
      </NavLink>
      <NavLink
        to="/calendar"
        className={({ isActive }) => `${linkClass} ${isActive ? activeClass : ''}`}
      >
        <Calendar className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
        Calendar
      </NavLink>
      {canViewReports && (
        <NavLink
          to="/reports"
          className={({ isActive }) => `${linkClass} ${isActive ? activeClass : ''}`}
        >
          <BarChart3 className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
          Reports
        </NavLink>
      )}
      <NavLink
        to="/inbox"
        className={({ isActive }) =>
          `${linkClass} ${isActive ? activeClass : ''} justify-between gap-2`
        }
      >
        <span className="flex min-w-0 flex-1 items-center gap-3">
          <Inbox className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
          <span className="truncate">Inbox</span>
        </span>
        {unreadInboxCount > 0 && (
          <span
            className="inline-flex min-h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-red-600 px-1.5 text-[11px] font-semibold tabular-nums leading-none text-white"
            aria-label={`${unreadInboxCount} unread`}
          >
            {unreadInboxCount > 99 ? '99+' : unreadInboxCount}
          </span>
        )}
      </NavLink>
      <NavLink
        to="/settings"
        className={({ isActive }) => `${linkClass} ${isActive ? activeClass : ''}`}
      >
        <Settings className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
        Settings
      </NavLink>
    </>
  )
}

type CourseNavLinksProps = {
  courseCode: string
}

function CourseNavLinks({ courseCode }: CourseNavLinksProps) {
  const { allows, loading: permLoading } = usePermissions()
  const base = `/courses/${encodeURIComponent(courseCode)}`
  const canViewGradebook =
    !permLoading && allows(courseGradebookViewPermission(courseCode))

  return (
    <>
      <NavLink
        to="/courses"
        className={({ isActive }) => `${linkClass} ${isActive ? activeClass : ''}`}
      >
        <ArrowLeft className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
        Back
      </NavLink>
      <p className="px-3 pb-1 pt-3 text-sm font-bold tracking-tight text-slate-900 dark:text-slate-100">
        Course Menu
      </p>
      <NavLink
        to={base}
        end
        className={({ isActive }) => `${linkClass} ${isActive ? activeClass : ''}`}
      >
        <LayoutDashboard className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
        Dashboard
      </NavLink>
      <NavLink
        to={`${base}/syllabus`}
        className={({ isActive }) => `${linkClass} ${isActive ? activeClass : ''}`}
      >
        <FileText className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
        Syllabus
      </NavLink>
      <NavLink
        to={`${base}/modules`}
        className={({ isActive }) => `${linkClass} ${isActive ? activeClass : ''}`}
      >
        <Layers className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
        Modules
      </NavLink>
      <NavLink
        to={`${base}/calendar`}
        className={({ isActive }) => `${linkClass} ${isActive ? activeClass : ''}`}
      >
        <Calendar className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
        Calendar
      </NavLink>
      {canViewGradebook && (
        <NavLink
          to={`${base}/gradebook`}
          className={({ isActive }) => `${linkClass} ${isActive ? activeClass : ''}`}
        >
          <ClipboardList className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
          Gradebook
        </NavLink>
      )}
      <NavLink
        to={`${base}/enrollments`}
        className={({ isActive }) => `${linkClass} ${isActive ? activeClass : ''}`}
      >
        <Users className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
        Enrollments
      </NavLink>
      <NavLink
        to={`${base}/settings`}
        className={({ isActive }) => `${linkClass} ${isActive ? activeClass : ''}`}
      >
        <Settings className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
        Settings
      </NavLink>
    </>
  )
}

function settingsTabFromPathname(pathname: string): 'ai' | 'account' | 'notifications' | 'roles' {
  const m = matchPath({ path: '/settings/:tab', end: true }, pathname)
  const raw = m?.params.tab
  if (raw === 'ai' || raw === 'account' || raw === 'notifications' || raw === 'roles') return raw
  return 'ai'
}

type CourseSettingsSection = 'basic' | 'dates' | 'branding' | 'grading'

function courseSettingsSectionFromPathname(pathname: string): CourseSettingsSection {
  const m = matchPath({ path: '/courses/:courseCode/settings/*', end: true }, pathname)
  const raw = m?.params['*']?.replace(/^\/+/, '') ?? ''
  const parts = raw.split('/').filter(Boolean)
  if (parts.length > 1) return 'basic'
  if (parts[0] === 'dates') return 'dates'
  if (parts[0] === 'branding') return 'branding'
  if (parts[0] === 'grading') return 'grading'
  return 'basic'
}

type CourseSettingsNavLinksProps = {
  courseCode: string
}

function CourseSettingsNavLinks({ courseCode }: CourseSettingsNavLinksProps) {
  const location = useLocation()
  const section = courseSettingsSectionFromPathname(location.pathname)
  const base = `/courses/${encodeURIComponent(courseCode)}/settings`

  return (
    <>
      <NavLink
        to={`/courses/${encodeURIComponent(courseCode)}`}
        className={({ isActive }) => `${linkClass} ${isActive ? activeClass : ''}`}
      >
        <ArrowLeft className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
        Back
      </NavLink>
      <p className="px-3 pb-1 pt-3 text-sm font-bold tracking-tight text-slate-900 dark:text-slate-100">
        Course Settings
      </p>
      <NavLink
        to={base}
        end
        className={() => `${linkClass} ${section === 'basic' ? activeClass : ''}`}
      >
        <Info className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
        Basic Information
      </NavLink>
      <NavLink
        to={`${base}/dates`}
        className={() => `${linkClass} ${section === 'dates' ? activeClass : ''}`}
      >
        <Calendar className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
        Dates
      </NavLink>
      <NavLink
        to={`${base}/branding`}
        className={() => `${linkClass} ${section === 'branding' ? activeClass : ''}`}
      >
        <Palette className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
        Branding
      </NavLink>
      <NavLink
        to={`${base}/grading`}
        className={() => `${linkClass} ${section === 'grading' ? activeClass : ''}`}
      >
        <Scale className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
        Grading
      </NavLink>
    </>
  )
}

function SettingsNavLinks() {
  const location = useLocation()
  const tab = settingsTabFromPathname(location.pathname)

  return (
    <>
      <NavLink
        to="/"
        end
        className={({ isActive }) => `${linkClass} ${isActive ? activeClass : ''}`}
      >
        <ArrowLeft className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
        Back
      </NavLink>
      <p className="px-3 pb-1 pt-3 text-sm font-bold tracking-tight text-slate-900 dark:text-slate-100">
        User Settings
      </p>
      <NavLink
        to="/settings/account"
        className={() => `${linkClass} ${tab === 'account' ? activeClass : ''}`}
      >
        <User className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
        Account
      </NavLink>
      <NavLink
        to="/settings/notifications"
        className={() => `${linkClass} ${tab === 'notifications' ? activeClass : ''}`}
      >
        <Bell className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
        Notifications
      </NavLink>
      <p className="px-3 pb-1 pt-4 text-sm font-bold tracking-tight text-slate-900 dark:text-slate-100">
        System Settings
      </p>
      <NavLink
        to="/settings/roles"
        className={() => `${linkClass} ${tab === 'roles' ? activeClass : ''}`}
      >
        <Shield className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
        Roles and Permissions
      </NavLink>
      <NavLink
        to="/settings/ai"
        className={() => `${linkClass} ${tab === 'ai' ? activeClass : ''}`}
      >
        <Bot className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
        Artificial Intelligence
      </NavLink>
    </>
  )
}

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
          <MainNavLinks />
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
          {courseCode && <CourseNavLinks key={courseCode} courseCode={courseCode} />}
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
            <CourseSettingsNavLinks
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
          {showSettingsNav && <SettingsNavLinks />}
        </nav>
      </div>
    </aside>
  )
}
