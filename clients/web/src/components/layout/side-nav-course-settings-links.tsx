import { useLocation } from 'react-router-dom'
import {
  Archive,
  ArrowLeft,
  BookCopy,
  FolderInput,
  Info,
  LayoutGrid,
  Scale,
  SlidersHorizontal,
  Target,
} from 'lucide-react'
import { courseSettingsSectionFromPathname } from './side-nav-path-utils'
import { sideNavActiveClass } from './side-nav-styles'
import { SideNavLink } from './side-nav-link'
import { useShellNav } from './use-shell-nav'

type SideNavCourseSettingsLinksProps = {
  courseCode: string
}

export function SideNavCourseSettingsLinks({ courseCode }: SideNavCourseSettingsLinksProps) {
  const location = useLocation()
  const { sideNavCollapsed } = useShellNav()
  const section = courseSettingsSectionFromPathname(location.pathname)
  const base = `/courses/${encodeURIComponent(courseCode)}/settings`

  return (
    <>
      <SideNavLink
        to={`/courses/${encodeURIComponent(courseCode)}`}
        icon={<ArrowLeft className="h-5 w-5" />}
      >
        Back
      </SideNavLink>
      {!sideNavCollapsed && (
        <p className="px-3 pb-1 pt-3 text-sm font-bold tracking-tight text-slate-900 dark:text-neutral-100">
          Course Settings
        </p>
      )}
      <SideNavLink
        to={`${base}/general`}
        className={() => (section === 'general' ? sideNavActiveClass : '')}
        icon={<Info className="h-5 w-5" />}
      >
        General
      </SideNavLink>
      <SideNavLink
        to={`${base}/grading`}
        className={() => (section === 'grading' ? sideNavActiveClass : '')}
        icon={<Scale className="h-5 w-5" />}
      >
        Grading
      </SideNavLink>
      <SideNavLink
        to={`${base}/outcomes`}
        className={() => (section === 'outcomes' ? sideNavActiveClass : '')}
        icon={<Target className="h-5 w-5" />}
      >
        Outcomes
      </SideNavLink>
      <SideNavLink
        to={`${base}/features`}
        className={() => (section === 'features' ? sideNavActiveClass : '')}
        icon={<SlidersHorizontal className="h-5 w-5" />}
      >
        Features
      </SideNavLink>
      <SideNavLink
        to={`${base}/sections`}
        className={() => (section === 'sections' ? sideNavActiveClass : '')}
        icon={<LayoutGrid className="h-5 w-5" />}
      >
        Sections
      </SideNavLink>
      <SideNavLink
        to={`${base}/import-export`}
        className={() => (section === 'import-export' ? sideNavActiveClass : '')}
        icon={<FolderInput className="h-5 w-5" />}
      >
        Import / export
      </SideNavLink>
      <SideNavLink
        to={`${base}/blueprint`}
        className={() => (section === 'blueprint' ? sideNavActiveClass : '')}
        icon={<BookCopy className="h-5 w-5" />}
      >
        Blueprint
      </SideNavLink>
      <SideNavLink
        to={`${base}/archive`}
        className={() => (section === 'archive' ? sideNavActiveClass : '')}
        icon={<Archive className="h-5 w-5" />}
      >
        Archived
      </SideNavLink>
    </>
  )
}
