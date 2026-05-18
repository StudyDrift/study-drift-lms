import {
  Accessibility,
  BarChart3,
  BookMarked,
  BookOpen,
  Calendar,
  Inbox,
  LayoutDashboard,
  Settings,
  UsersRound,
} from 'lucide-react'
import { useInboxUnreadCount } from '../../context/use-inbox-unread'
import { usePermissions } from '../../context/use-permissions'
import {
  PERM_ACCOMMODATIONS_MANAGE,
  PERM_PARENT_DASHBOARD,
  PERM_REPORTS_VIEW,
} from '../../lib/rbac-api'
import { SideNavLink } from './side-nav-link'

export function SideNavMainLinks() {
  const unreadInboxCount = useInboxUnreadCount()
  const { allows, loading: permLoading } = usePermissions()

  const canViewReports = !permLoading && allows(PERM_REPORTS_VIEW)
  const canManageAccommodations = !permLoading && allows(PERM_ACCOMMODATIONS_MANAGE)
  const isParent = !permLoading && allows(PERM_PARENT_DASHBOARD)

  const unreadBadge = unreadInboxCount > 0 && (
    <span
      className="inline-flex min-h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-red-600 px-1.5 text-[11px] font-semibold tabular-nums leading-none text-white"
      aria-label={`${unreadInboxCount} unread`}
    >
      {unreadInboxCount > 99 ? '99+' : unreadInboxCount}
    </span>
  )

  return (
    <>
      <SideNavLink to="/" end icon={<LayoutDashboard className="h-5 w-5" />}>
        Dashboard
      </SideNavLink>
      {isParent && (
        <SideNavLink to="/parent" icon={<UsersRound className="h-5 w-5" />}>
          Family
        </SideNavLink>
      )}
      <SideNavLink to="/courses" icon={<BookOpen className="h-5 w-5" />}>
        Courses
      </SideNavLink>
      <SideNavLink to="/notebooks" icon={<BookMarked className="h-5 w-5" />}>
        My Notebooks
      </SideNavLink>
      <SideNavLink to="/calendar" icon={<Calendar className="h-5 w-5" />}>
        Calendar
      </SideNavLink>
      {canViewReports && (
        <SideNavLink to="/reports" icon={<BarChart3 className="h-5 w-5" />}>
          Reports
        </SideNavLink>
      )}
      {canManageAccommodations && (
        <SideNavLink to="/admin/accommodations" icon={<Accessibility className="h-5 w-5" />}>
          Accommodations
        </SideNavLink>
      )}
      <SideNavLink
        to="/inbox"
        data-onboarding="nav-inbox"
        icon={<Inbox className="h-5 w-5" />}
        badge={unreadBadge}
      >
        Inbox
      </SideNavLink>
      <SideNavLink to="/settings" data-onboarding="nav-settings" icon={<Settings className="h-5 w-5" />}>
        Settings
      </SideNavLink>
    </>
  )
}
