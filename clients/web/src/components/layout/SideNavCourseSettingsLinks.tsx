import { NavLink, useLocation } from 'react-router-dom'
import { Archive, ArrowLeft, Calendar, FolderInput, Info, Palette, Scale } from 'lucide-react'
import { courseSettingsSectionFromPathname } from './sideNavPathUtils'
import { sideNavActiveClass, sideNavLinkClass } from './sideNavStyles'

type SideNavCourseSettingsLinksProps = {
  courseCode: string
}

export function SideNavCourseSettingsLinks({ courseCode }: SideNavCourseSettingsLinksProps) {
  const location = useLocation()
  const section = courseSettingsSectionFromPathname(location.pathname)
  const base = `/courses/${encodeURIComponent(courseCode)}/settings`

  return (
    <>
      <NavLink
        to={`/courses/${encodeURIComponent(courseCode)}`}
        className={({ isActive }) => `${sideNavLinkClass} ${isActive ? sideNavActiveClass : ''}`}
      >
        <ArrowLeft className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
        Back
      </NavLink>
      <p className="px-3 pb-1 pt-3 text-sm font-bold tracking-tight text-slate-900 dark:text-neutral-100">
        Course Settings
      </p>
      <NavLink
        to={base}
        end
        className={() => `${sideNavLinkClass} ${section === 'basic' ? sideNavActiveClass : ''}`}
      >
        <Info className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
        Basic Information
      </NavLink>
      <NavLink
        to={`${base}/dates`}
        className={() => `${sideNavLinkClass} ${section === 'dates' ? sideNavActiveClass : ''}`}
      >
        <Calendar className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
        Dates
      </NavLink>
      <NavLink
        to={`${base}/branding`}
        className={() => `${sideNavLinkClass} ${section === 'branding' ? sideNavActiveClass : ''}`}
      >
        <Palette className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
        Branding
      </NavLink>
      <NavLink
        to={`${base}/grading`}
        className={() => `${sideNavLinkClass} ${section === 'grading' ? sideNavActiveClass : ''}`}
      >
        <Scale className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
        Grading
      </NavLink>
      <NavLink
        to={`${base}/export-import`}
        className={() =>
          `${sideNavLinkClass} ${section === 'export-import' ? sideNavActiveClass : ''}`
        }
      >
        <FolderInput className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
        Export/Import
      </NavLink>
      <NavLink
        to={`${base}/archived`}
        className={() => `${sideNavLinkClass} ${section === 'archived' ? sideNavActiveClass : ''}`}
      >
        <Archive className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
        Archived
      </NavLink>
    </>
  )
}
