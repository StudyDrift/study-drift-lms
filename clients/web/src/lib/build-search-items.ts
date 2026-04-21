import {
  courseEnrollmentsReadPermission,
  courseGradebookViewPermission,
  courseItemCreatePermission,
} from './courses-api'
import type { SearchCourseItem, SearchPersonItem } from './search-api'
import { PERM_COURSE_CREATE, PERM_RBAC_MANAGE, PERM_REPORTS_VIEW } from './rbac-api'

export type SearchGroup = 'course' | 'person' | 'page' | 'action'

export type SearchListItem = {
  id: string
  group: SearchGroup
  title: string
  subtitle: string
  path: string
  /** Lowercase text used for client-side filtering */
  haystack: string
}

function enc(s: string): string {
  return encodeURIComponent(s)
}

/** Second line in command palette: course title + code (disambiguates duplicate page names). */
function courseSearchBreadcrumb(c: SearchCourseItem): string {
  const t = c.title.trim()
  return t ? `${t} · ${c.courseCode}` : c.courseCode
}

function personLabel(p: SearchPersonItem): string {
  const name = p.displayName?.trim()
  return name || p.email
}

export function buildSearchItems(
  courses: SearchCourseItem[],
  people: SearchPersonItem[],
  allows: (perm: string) => boolean,
): SearchListItem[] {
  const items: SearchListItem[] = []

  for (const c of courses) {
    const path = `/courses/${enc(c.courseCode)}`
    const title = c.title
    const subtitle = c.courseCode
    items.push({
      id: `course:${c.courseCode}`,
      group: 'course',
      title,
      subtitle,
      path,
      haystack: `${title} ${subtitle} course`.toLowerCase(),
    })
  }

  for (const p of people) {
    if (!allows(courseEnrollmentsReadPermission(p.courseCode))) {
      continue
    }
    const label = personLabel(p)
    const subtitle = `${p.courseTitle} · ${p.courseCode} · ${p.role}`
    const path = `/courses/${enc(p.courseCode)}/enrollments`
    items.push({
      id: `person:${p.userId}:${p.courseCode}`,
      group: 'person',
      title: label,
      subtitle,
      path,
      haystack: `${label} ${p.email} ${p.role} ${p.courseTitle} ${p.courseCode} people enrollment`.toLowerCase(),
    })
  }

  const globalPages: { title: string; subtitle: string; path: string; hint: string }[] = [
    { title: 'Dashboard', subtitle: 'Home', path: '/', hint: 'dashboard home' },
    { title: 'Courses', subtitle: 'All your courses', path: '/courses', hint: 'courses catalog' },
    {
      title: 'My Notebooks',
      subtitle: 'Notes across courses',
      path: '/notebooks',
      hint: 'notebooks notes journal',
    },
    { title: 'Calendar', subtitle: 'Your schedule', path: '/calendar', hint: 'calendar schedule' },
    { title: 'Inbox', subtitle: 'Messages', path: '/inbox', hint: 'inbox messages mail' },
    {
      title: 'Account',
      subtitle: 'User settings',
      path: '/settings/account',
      hint: 'account profile settings user preferences theme',
    },
    {
      title: 'Notifications',
      subtitle: 'User settings',
      path: '/settings/notifications',
      hint: 'notifications alerts email preferences',
    },
  ]

  for (const g of globalPages) {
    items.push({
      id: `page:${g.path}`,
      group: 'page',
      title: g.title,
      subtitle: g.subtitle,
      path: g.path,
      haystack: `${g.title} ${g.subtitle} ${g.hint} page`.toLowerCase(),
    })
  }

  if (allows(PERM_RBAC_MANAGE)) {
    items.push({
      id: 'page:/settings/ai/models',
      group: 'page',
      title: 'AI models',
      subtitle: 'System settings',
      path: '/settings/ai/models',
      haystack: 'ai intelligence openrouter models system settings page'.toLowerCase(),
    })
    items.push({
      id: 'page:/settings/ai/system-prompts',
      group: 'page',
      title: 'System prompts',
      subtitle: 'System settings',
      path: '/settings/ai/system-prompts',
      haystack: 'system prompts ai configuration admin page'.toLowerCase(),
    })
    items.push({
      id: 'page:/settings/roles',
      group: 'page',
      title: 'Roles and Permissions',
      subtitle: 'System settings',
      path: '/settings/roles',
      haystack: 'roles permissions rbac security admin page'.toLowerCase(),
    })
  }

  if (allows(PERM_REPORTS_VIEW)) {
    items.push({
      id: 'page:/reports',
      group: 'page',
      title: 'Reports',
      subtitle: 'Learning activity',
      path: '/reports',
      haystack: 'reports analytics audit activity learning page'.toLowerCase(),
    })
  }

  const coursePageDefs: {
    suffix: string
    title: string
    hint: string
    /** If set, the page is only searchable when `allows(permission(courseCode))` is true. */
    requiredPermission?: (courseCode: string) => string
    /** If set, omit when the course has turned off this tool. */
    whenCourse?: (c: SearchCourseItem) => boolean
  }[] = [
    { suffix: '', title: 'Course dashboard', hint: 'dashboard overview' },
    {
      suffix: '/feed',
      title: 'Feed',
      hint: 'feed chat channels messages discussion',
      whenCourse: (c) => c.feedEnabled !== false,
    },
    { suffix: '/syllabus', title: 'Syllabus', hint: 'syllabus outline' },
    {
      suffix: '/modules',
      title: 'Modules',
      hint: 'modules lessons content pages assignments quizzes external links',
    },
    {
      suffix: '/notebook',
      title: 'Notebook',
      hint: 'notes journal thoughts',
      whenCourse: (c) => c.notebookEnabled !== false,
    },
    {
      suffix: '/calendar',
      title: 'Course calendar',
      hint: 'calendar schedule',
      whenCourse: (c) => c.calendarEnabled !== false,
    },
    {
      suffix: '/my-grades',
      title: 'My grades',
      hint: 'grades scores student your grades',
    },
    {
      suffix: '/gradebook',
      title: 'Gradebook',
      hint: 'gradebook grades scores',
      requiredPermission: courseGradebookViewPermission,
    },
    {
      suffix: '/enrollments',
      title: 'Enrollments',
      hint: 'enrollments people roster students',
      requiredPermission: courseEnrollmentsReadPermission,
    },
    {
      suffix: '/settings/general',
      title: 'Course settings',
      hint: 'settings configuration title description dates schedule hero branding',
      requiredPermission: courseItemCreatePermission,
    },
  ]

  for (const c of courses) {
    const base = `/courses/${enc(c.courseCode)}`
    for (const def of coursePageDefs) {
      if (def.requiredPermission && !allows(def.requiredPermission(c.courseCode))) {
        continue
      }
      if (def.whenCourse && !def.whenCourse(c)) {
        continue
      }
      const path = `${base}${def.suffix}`
      items.push({
        id: `page:${path}`,
        group: 'page',
        title: def.title,
        subtitle: courseSearchBreadcrumb(c),
        path,
        haystack: `${def.title} ${c.title} ${c.courseCode} ${def.hint} page`.toLowerCase(),
      })
    }
  }

  const courseSettingsSectionDefs: {
    suffix: string
    title: string
    hint: string
    requiredPermission?: (courseCode: string) => string
  }[] = [
    {
      suffix: '/settings/grading',
      title: 'Grading settings',
      hint: 'grading scale assignment groups weights categories',
      requiredPermission: courseGradebookViewPermission,
    },
    {
      suffix: '/settings/outcomes',
      title: 'Course outcomes',
      hint: 'learning outcomes objectives alignment evidence quiz questions progress',
      requiredPermission: courseItemCreatePermission,
    },
    {
      suffix: '/settings/features',
      title: 'Course features',
      hint: 'features tools notebook feed calendar enable disable toggles',
      requiredPermission: courseItemCreatePermission,
    },
    {
      suffix: '/settings/import-export',
      title: 'Import / export',
      hint: 'export import backup canvas migrate course package',
      requiredPermission: courseItemCreatePermission,
    },
    {
      suffix: '/settings/archive',
      title: 'Archived modules',
      hint: 'archived deleted restore trash unarchive structure',
      requiredPermission: courseItemCreatePermission,
    },
  ]

  for (const c of courses) {
    const base = `/courses/${enc(c.courseCode)}`
    for (const def of courseSettingsSectionDefs) {
      if (def.requiredPermission && !allows(def.requiredPermission(c.courseCode))) {
        continue
      }
      const path = `${base}${def.suffix}`
      items.push({
        id: `page:${path}`,
        group: 'page',
        title: def.title,
        subtitle: courseSearchBreadcrumb(c),
        path,
        haystack: `${def.title} ${c.title} ${c.courseCode} course settings ${def.hint} page`.toLowerCase(),
      })
    }
  }

  if (allows(PERM_COURSE_CREATE)) {
    items.push({
      id: 'action:/courses/create',
      group: 'action',
      title: 'Create new course',
      subtitle: 'Add a course to the catalog',
      path: '/courses/create',
      haystack: 'create new course add action'.toLowerCase(),
    })
  }

  for (const c of courses) {
    if (!allows(courseEnrollmentsReadPermission(c.courseCode))) {
      continue
    }
    const path = `/courses/${enc(c.courseCode)}/enrollments`
    items.push({
      id: `action:${path}:add`,
      group: 'action',
      title: 'Add people',
      subtitle: courseSearchBreadcrumb(c),
      path,
      haystack: `add enrollment enroll people invite students open enrollments learners ${c.title} ${c.courseCode} action`.toLowerCase(),
    })
  }

  return items
}

function sortSearchItems(items: SearchListItem[]): SearchListItem[] {
  return [...items].sort((a, b) => {
    const gi = GROUP_ORDER.indexOf(a.group)
    const gj = GROUP_ORDER.indexOf(b.group)
    if (gi !== gj) return gi - gj
    const byTitle = a.title.localeCompare(b.title)
    if (byTitle !== 0) return byTitle
    const byCtx = a.subtitle.localeCompare(b.subtitle)
    if (byCtx !== 0) return byCtx
    return a.path.localeCompare(b.path)
  })
}

export function filterSearchItems(items: SearchListItem[], query: string): SearchListItem[] {
  const q = query.trim().toLowerCase()
  const words = q.split(/\s+/).filter(Boolean)
  const filtered = words.length
    ? items.filter((it) => words.every((w) => it.haystack.includes(w)))
    : items
  return sortSearchItems(filtered)
}

const GROUP_ORDER: SearchGroup[] = ['action', 'course', 'person', 'page']

export const SEARCH_GROUP_LABEL: Record<SearchGroup, string> = {
  action: 'Actions',
  course: 'Courses',
  person: 'People',
  page: 'Pages',
}
