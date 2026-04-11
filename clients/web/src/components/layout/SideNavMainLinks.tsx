import { NavLink } from 'react-router-dom'
import {
  BarChart3,
  BookMarked,
  BookOpen,
  Calendar,
  Inbox,
  LayoutDashboard,
  Settings,
} from 'lucide-react'
import { useInboxUnreadCount } from '../../context/useInboxUnread'
import { usePermissions } from '../../context/usePermissions'
import { PERM_REPORTS_VIEW } from '../../lib/rbacApi'
import { sideNavActiveClass, sideNavLinkClass } from './sideNavStyles'

export function SideNavMainLinks() {
  const unreadInboxCount = useInboxUnreadCount()
  const { allows, loading: permLoading } = usePermissions()
  const canViewReports = !permLoading && allows(PERM_REPORTS_VIEW)

  return (
    <>
      <NavLink
        to="/"
        end
        className={({ isActive }) => `${sideNavLinkClass} ${isActive ? sideNavActiveClass : ''}`}
      >
        <LayoutDashboard className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
        Dashboard
      </NavLink>
      <NavLink
        to="/courses"
        className={({ isActive }) => `${sideNavLinkClass} ${isActive ? sideNavActiveClass : ''}`}
      >
        <BookOpen className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
        Courses
      </NavLink>
      <NavLink
        to="/notebooks"
        className={({ isActive }) => `${sideNavLinkClass} ${isActive ? sideNavActiveClass : ''}`}
      >
        <BookMarked className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
        My Notebooks
      </NavLink>
      <NavLink
        to="/calendar"
        className={({ isActive }) => `${sideNavLinkClass} ${isActive ? sideNavActiveClass : ''}`}
      >
        <Calendar className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
        Calendar
      </NavLink>
      {canViewReports && (
        <NavLink
          to="/reports"
          className={({ isActive }) => `${sideNavLinkClass} ${isActive ? sideNavActiveClass : ''}`}
        >
          <BarChart3 className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
          Reports
        </NavLink>
      )}
      <NavLink
        to="/inbox"
        className={({ isActive }) =>
          `${sideNavLinkClass} ${isActive ? sideNavActiveClass : ''} justify-between gap-2`
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
        className={({ isActive }) => `${sideNavLinkClass} ${isActive ? sideNavActiveClass : ''}`}
      >
        <Settings className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
        Settings
      </NavLink>
    </>
  )
}
