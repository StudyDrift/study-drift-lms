import { NavLink } from 'react-router-dom'
import {
  ArrowLeft,
  Award,
  Calendar,
  ClipboardList,
  FileText,
  Layers,
  LayoutDashboard,
  ListChecks,
  MessageSquare,
  NotebookPen,
  Settings,
  Users,
} from 'lucide-react'
import { useCourseNavFeatures } from '../../context/course-nav-features-context'
import { usePermissions } from '../../context/use-permissions'
import {
  courseEnrollmentsReadPermission,
  courseGradebookViewPermission,
  courseItemCreatePermission,
  courseItemsCreatePermission,
  viewerIsCourseStaffEnrollment,
  viewerShouldHideCourseEnrollmentsNav,
  viewerShouldShowMyGradesNav,
} from '../../lib/courses-api'
import { useCourseViewAs } from '../../lib/course-view-as'
import { useViewerEnrollmentRoles } from '../../lib/use-viewer-enrollment-roles'
import { sideNavActiveClass, sideNavLinkClass } from './side-nav-styles'

type SideNavCourseLinksProps = {
  courseCode: string
}

export function SideNavCourseLinks({ courseCode }: SideNavCourseLinksProps) {
  const { notebookEnabled, feedEnabled, calendarEnabled, questionBankEnabled } = useCourseNavFeatures()
  const { allows, loading: permLoading } = usePermissions()
  const courseViewPreview = useCourseViewAs(courseCode)
  const viewerEnrollmentRoles = useViewerEnrollmentRoles(courseCode)

  const base = `/courses/${encodeURIComponent(courseCode)}`
  const canViewGradebook =
    !permLoading && allows(courseGradebookViewPermission(courseCode))
  const canViewEnrollments =
    viewerEnrollmentRoles !== null &&
    viewerIsCourseStaffEnrollment(viewerEnrollmentRoles) &&
    !viewerShouldHideCourseEnrollmentsNav(viewerEnrollmentRoles, courseViewPreview) &&
    !permLoading &&
    allows(courseEnrollmentsReadPermission(courseCode))
  const canViewMyGrades = viewerShouldShowMyGradesNav(viewerEnrollmentRoles, courseViewPreview)
  const canManageCourse =
    !permLoading && allows(courseItemCreatePermission(courseCode))
  const canManageQuestionBank =
    !permLoading && allows(courseItemsCreatePermission(courseCode))

  return (
    <>
      <NavLink
        to="/courses"
        className={({ isActive }) => `${sideNavLinkClass} ${isActive ? sideNavActiveClass : ''}`}
      >
        <ArrowLeft className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
        Back
      </NavLink>
      <p className="px-3 pb-1 pt-3 text-sm font-bold tracking-tight text-slate-900 dark:text-neutral-100">
        Course Menu
      </p>
      <NavLink
        to={base}
        end
        className={({ isActive }) => `${sideNavLinkClass} ${isActive ? sideNavActiveClass : ''}`}
      >
        <LayoutDashboard className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
        Dashboard
      </NavLink>
      {feedEnabled && (
        <NavLink
          to={`${base}/feed`}
          className={({ isActive }) => `${sideNavLinkClass} ${isActive ? sideNavActiveClass : ''}`}
        >
          <MessageSquare className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
          Feed
        </NavLink>
      )}
      <NavLink
        to={`${base}/syllabus`}
        className={({ isActive }) => `${sideNavLinkClass} ${isActive ? sideNavActiveClass : ''}`}
      >
        <FileText className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
        Syllabus
      </NavLink>
      <NavLink
        to={`${base}/modules`}
        className={({ isActive }) => `${sideNavLinkClass} ${isActive ? sideNavActiveClass : ''}`}
      >
        <Layers className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
        Modules
      </NavLink>
      {canManageQuestionBank && questionBankEnabled && (
        <NavLink
          to={`${base}/questions`}
          className={({ isActive }) => `${sideNavLinkClass} ${isActive ? sideNavActiveClass : ''}`}
        >
          <ListChecks className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
          Question bank
        </NavLink>
      )}
      {notebookEnabled && (
        <NavLink
          to={`${base}/notebook`}
          className={({ isActive }) => `${sideNavLinkClass} ${isActive ? sideNavActiveClass : ''}`}
        >
          <NotebookPen className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
          Notebook
        </NavLink>
      )}
      {calendarEnabled && (
        <NavLink
          to={`${base}/calendar`}
          className={({ isActive }) => `${sideNavLinkClass} ${isActive ? sideNavActiveClass : ''}`}
        >
          <Calendar className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
          Calendar
        </NavLink>
      )}
      {canViewMyGrades && (
        <NavLink
          to={`${base}/my-grades`}
          className={({ isActive }) => `${sideNavLinkClass} ${isActive ? sideNavActiveClass : ''}`}
        >
          <Award className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
          My grades
        </NavLink>
      )}
      {canViewGradebook && (
        <NavLink
          to={`${base}/gradebook`}
          className={({ isActive }) => `${sideNavLinkClass} ${isActive ? sideNavActiveClass : ''}`}
        >
          <ClipboardList className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
          Gradebook
        </NavLink>
      )}
      {canViewEnrollments && (
        <NavLink
          to={`${base}/enrollments`}
          className={({ isActive }) => `${sideNavLinkClass} ${isActive ? sideNavActiveClass : ''}`}
        >
          <Users className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
          Enrollments
        </NavLink>
      )}
      {canManageCourse && (
        <NavLink
          to={`${base}/settings`}
          className={({ isActive }) => `${sideNavLinkClass} ${isActive ? sideNavActiveClass : ''}`}
        >
          <Settings className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
          Settings
        </NavLink>
      )}
    </>
  )
}
