import { NavLink, useLocation } from 'react-router-dom'
import {
  Archive,
  ArrowLeft,
  FolderInput,
  Info,
  Scale,
  SlidersHorizontal,
  Target,
} from 'lucide-react'
import { courseSettingsSectionFromPathname } from './side-nav-path-utils'
import { sideNavActiveClass, sideNavLinkClass } from './side-nav-styles'

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
        to={`${base}/general`}
        className={() => `${sideNavLinkClass} ${section === 'general' ? sideNavActiveClass : ''}`}
      >
        <Info className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
        General
      </NavLink>
      <NavLink
        to={`${base}/grading`}
        className={() => `${sideNavLinkClass} ${section === 'grading' ? sideNavActiveClass : ''}`}
      >
        <Scale className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
        Grading
      </NavLink>
      <NavLink
        to={`${base}/outcomes`}
        className={() => `${sideNavLinkClass} ${section === 'outcomes' ? sideNavActiveClass : ''}`}
      >
        <Target className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
        Outcomes
      </NavLink>
      <NavLink
        to={`${base}/features`}
        className={() =>
          `${sideNavLinkClass} ${section === 'features' ? sideNavActiveClass : ''}`
        }
      >
        <SlidersHorizontal className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
        Features
      </NavLink>
      <NavLink
        to={`${base}/import-export`}
        className={() =>
          `${sideNavLinkClass} ${section === 'import-export' ? sideNavActiveClass : ''}`
        }
      >
        <FolderInput className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
        Import / export
      </NavLink>
      <NavLink
        to={`${base}/archive`}
        className={() => `${sideNavLinkClass} ${section === 'archive' ? sideNavActiveClass : ''}`}
      >
        <Archive className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
        Archived
      </NavLink>
    </>
  )
}
