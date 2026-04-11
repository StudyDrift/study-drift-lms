import { NavLink } from 'react-router-dom'
import {
  ArrowLeft,
  Calendar,
  ClipboardList,
  FileText,
  Layers,
  LayoutDashboard,
  NotebookPen,
  Settings,
  Users,
} from 'lucide-react'
import { usePermissions } from '../../context/usePermissions'
import { courseEnrollmentsReadPermission, courseGradebookViewPermission } from '../../lib/coursesApi'
import { sideNavActiveClass, sideNavLinkClass } from './sideNavStyles'

type SideNavCourseLinksProps = {
  courseCode: string
}

export function SideNavCourseLinks({ courseCode }: SideNavCourseLinksProps) {
  const { allows, loading: permLoading } = usePermissions()
  const base = `/courses/${encodeURIComponent(courseCode)}`
  const canViewGradebook =
    !permLoading && allows(courseGradebookViewPermission(courseCode))
  const canViewEnrollments =
    !permLoading && allows(courseEnrollmentsReadPermission(courseCode))

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
      <NavLink
        to={`${base}/notebook`}
        className={({ isActive }) => `${sideNavLinkClass} ${isActive ? sideNavActiveClass : ''}`}
      >
        <NotebookPen className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
        Notebook
      </NavLink>
      <NavLink
        to={`${base}/calendar`}
        className={({ isActive }) => `${sideNavLinkClass} ${isActive ? sideNavActiveClass : ''}`}
      >
        <Calendar className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
        Calendar
      </NavLink>
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
      <NavLink
        to={`${base}/settings`}
        className={({ isActive }) => `${sideNavLinkClass} ${isActive ? sideNavActiveClass : ''}`}
      >
        <Settings className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
        Settings
      </NavLink>
    </>
  )
}
