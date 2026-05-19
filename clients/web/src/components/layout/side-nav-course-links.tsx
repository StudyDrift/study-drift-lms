import { useLocation } from 'react-router-dom'
import {
  ArrowLeft,
  Award,
  BookMarked,
  Calendar,
  ClipboardList,
  FileText,
  Layers,
  LayoutDashboard,
  Lightbulb,
  ListChecks,
  MessageSquare,
  MessagesSquare,
  NotebookPen,
  PenLine,
  Settings,
  Users,
  UsersRound,
  Video,
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
import { sideNavActiveClass } from './side-nav-styles'
import { SideNavLink } from './side-nav-link'
import { useShellNav } from './use-shell-nav'

type SideNavCourseLinksProps = {
  courseCode: string
}

export function SideNavCourseLinks({ courseCode }: SideNavCourseLinksProps) {
  const location = useLocation()
  const { sideNavCollapsed } = useShellNav()
  const {
    notebookEnabled,
    feedEnabled,
    calendarEnabled,
    questionBankEnabled,
    standardsAlignmentEnabled,
    discussionsEnabled,
    collabDocsEnabled,
    sbgEnabled,
    liveSessionsEnabled,
    groupSpacesEnabled,
  } = useCourseNavFeatures()
  const { allows, loading: permLoading } = usePermissions()
  const courseViewPreview = useCourseViewAs(courseCode)
  const viewerEnrollmentRoles = useViewerEnrollmentRoles(courseCode)

  const base = `/courses/${encodeURIComponent(courseCode)}`
  const canViewGradebook = !permLoading && allows(courseGradebookViewPermission(courseCode))
  const canViewEnrollments =
    viewerEnrollmentRoles !== null &&
    viewerIsCourseStaffEnrollment(viewerEnrollmentRoles) &&
    !viewerShouldHideCourseEnrollmentsNav(viewerEnrollmentRoles, courseViewPreview) &&
    !permLoading &&
    allows(courseEnrollmentsReadPermission(courseCode))
  const canViewMyGrades = viewerShouldShowMyGradesNav(viewerEnrollmentRoles, courseViewPreview)
  const canManageCourse = !permLoading && allows(courseItemCreatePermission(courseCode))
  const canManageQuestionBank = !permLoading && allows(courseItemsCreatePermission(courseCode))

  return (
    <>
      <SideNavLink to="/courses" icon={<ArrowLeft className="h-5 w-5" />}>
        Back
      </SideNavLink>
      {!sideNavCollapsed && (
        <p className="px-3 pb-1 pt-3 text-sm font-bold tracking-tight text-slate-900 dark:text-neutral-100">
          Course Menu
        </p>
      )}
      <SideNavLink to={base} end icon={<LayoutDashboard className="h-5 w-5" />}>
        Dashboard
      </SideNavLink>
      {feedEnabled && (
        <SideNavLink to={`${base}/feed`} icon={<MessageSquare className="h-5 w-5" />}>
          Feed
        </SideNavLink>
      )}
      {discussionsEnabled && (
        <SideNavLink to={`${base}/discussions`} icon={<MessagesSquare className="h-5 w-5" />}>
          Discussions
        </SideNavLink>
      )}
      {collabDocsEnabled && (
        <SideNavLink to={`${base}/collab-docs`} icon={<PenLine className="h-5 w-5" />}>
          Collab docs
        </SideNavLink>
      )}
      {groupSpacesEnabled && (
        <SideNavLink to={`${base}/groups`} icon={<UsersRound className="h-5 w-5" />}>
          Groups
        </SideNavLink>
      )}
      <SideNavLink to={`${base}/syllabus`} icon={<FileText className="h-5 w-5" />}>
        Syllabus
      </SideNavLink>
      <SideNavLink to={`${base}/modules`} icon={<Layers className="h-5 w-5" />}>
        Modules
      </SideNavLink>
      {liveSessionsEnabled && (
        <SideNavLink to={`${base}/live`} icon={<Video className="h-5 w-5" />}>
          Live Sessions
        </SideNavLink>
      )}
      {canManageQuestionBank && questionBankEnabled && (
        <SideNavLink to={`${base}/questions`} icon={<ListChecks className="h-5 w-5" />}>
          Question bank
        </SideNavLink>
      )}
      {canManageQuestionBank && questionBankEnabled && (
        <SideNavLink to={`${base}/misconception-report`} icon={<Lightbulb className="h-5 w-5" />}>
          Misconceptions
        </SideNavLink>
      )}
      {notebookEnabled && (
        <SideNavLink to={`${base}/notebook`} icon={<NotebookPen className="h-5 w-5" />}>
          Notebook
        </SideNavLink>
      )}
      {calendarEnabled && (
        <SideNavLink to={`${base}/calendar`} icon={<Calendar className="h-5 w-5" />}>
          Calendar
        </SideNavLink>
      )}
      {canViewMyGrades && (
        <SideNavLink to={`${base}/my-grades`} icon={<Award className="h-5 w-5" />}>
          My grades
        </SideNavLink>
      )}
      {canViewGradebook && (
        <SideNavLink to={`${base}/gradebook`} icon={<ClipboardList className="h-5 w-5" />}>
          Gradebook
        </SideNavLink>
      )}
      {sbgEnabled && canViewGradebook && (
        <SideNavLink to={`${base}/standards-gradebook`} icon={<BookMarked className="h-5 w-5" />}>
          Standards gradebook
        </SideNavLink>
      )}
      {standardsAlignmentEnabled && (canViewGradebook || canManageCourse) && (
        <SideNavLink to={`${base}/standards-coverage`} icon={<BookMarked className="h-5 w-5" />}>
          Standards coverage
        </SideNavLink>
      )}
      {canViewEnrollments && (
        <SideNavLink to={`${base}/enrollments`} icon={<Users className="h-5 w-5" />}>
          Enrollments
        </SideNavLink>
      )}
      {canManageCourse && (
        <SideNavLink
          to={`${base}/settings/general`}
          className={() => {
            const settingsPrefix = `${base}/settings`
            const onSettings =
              location.pathname === settingsPrefix ||
              location.pathname.startsWith(`${settingsPrefix}/`)
            return onSettings ? sideNavActiveClass : ''
          }}
          icon={<Settings className="h-5 w-5" />}
        >
          Settings
        </SideNavLink>
      )}
    </>
  )
}
