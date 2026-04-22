/* eslint-disable react-hooks/set-state-in-effect -- sync breadcrumb async labels and cache when the route or course changes */
import { useEffect, useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { Link, matchPath, useLocation } from 'react-router-dom'
import {
  fetchCourse,
  fetchCourseStructure,
  type CourseStructureItem,
} from '../../lib/courses-api'
import {
  courseSettingsSectionFromPathname,
  settingsViewFromPathname,
  type CourseSettingsSection,
} from './side-nav-path-utils'

const courseTitleCache = new Map<string, string>()
const structureCache = new Map<string, CourseStructureItem[]>()

type Crumb = { key: string; label: string; to?: string }

const COURSE_SETTINGS_LABEL: Record<CourseSettingsSection, string> = {
  general: 'General',
  grading: 'Grading',
  outcomes: 'Outcomes',
  features: 'Features',
  'import-export': 'Import / export',
  archive: 'Archive',
}

function findItemModuleTitles(
  items: CourseStructureItem[],
  itemId: string,
): { itemTitle: string; moduleTitle: string | null } {
  const byId = new Map(items.map((i) => [i.id, i]))
  const item = byId.get(itemId)
  if (!item) return { itemTitle: 'Item', moduleTitle: null }
  let moduleTitle: string | null = null
  let cur: CourseStructureItem | undefined = item
  while (cur) {
    if (cur.kind === 'module') {
      moduleTitle = cur.title
      break
    }
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
  }
  return { itemTitle: item.title, moduleTitle }
}

function settingsSubLabel(view: ReturnType<typeof settingsViewFromPathname>): string {
  switch (view) {
    case 'account':
      return 'Account'
    case 'notifications':
      return 'Notifications'
    case 'roles':
      return 'Roles and Permissions'
    case 'ai-models':
      return 'Models'
    case 'ai-prompts':
      return 'System Prompts'
    default:
      return 'Account'
  }
}

/** Static trail from pathname only (course title / structure filled elsewhere). */
function staticCrumbsFromPathname(pathname: string, courseCode: string | null): Crumb[] {
  if (pathname === '/') return [{ key: 'dash', label: 'Dashboard' }]

  if (pathname === '/courses') return [{ key: 'courses', label: 'Courses' }]
  if (pathname === '/courses/create') {
    return [
      { key: 'courses', label: 'Courses', to: '/courses' },
      { key: 'create', label: 'Create course' },
    ]
  }

  if (pathname === '/notebooks') return [{ key: 'notebooks', label: 'Notebooks' }]
  if (pathname === '/calendar') return [{ key: 'cal', label: 'Calendar' }]
  if (pathname === '/inbox') return [{ key: 'inbox', label: 'Inbox' }]
  if (pathname === '/reports') return [{ key: 'reports', label: 'Reports' }]

  if (pathname === '/admin/accommodations') {
    return [
      { key: 'admin', label: 'Admin' },
      { key: 'acc', label: 'Accommodations' },
    ]
  }

  if (pathname === '/terms') return [{ key: 'terms', label: 'Terms of Use' }]
  if (pathname === '/privacy') return [{ key: 'privacy', label: 'Privacy Policy' }]

  if (pathname.startsWith('/settings')) {
    const view = settingsViewFromPathname(pathname)
    return [
      { key: 'uset', label: 'User settings', to: '/settings/account' },
      { key: 'leaf', label: settingsSubLabel(view) },
    ]
  }

  if (!courseCode) return []

  const enc = encodeURIComponent(courseCode)
  const base = `/courses/${enc}`

  const courseCrumb = (label: string, withLink: boolean): Crumb => ({
    key: 'course',
    label,
    to: withLink ? base : undefined,
  })

  const onCourseSettings =
    pathname === `${base}/settings` || pathname.startsWith(`${base}/settings/`)
  if (courseCode && onCourseSettings) {
    const section = courseSettingsSectionFromPathname(pathname)
    const sectionLabel = COURSE_SETTINGS_LABEL[section]
    return [
      courseCrumb(courseCode, true),
      { key: 'settings', label: 'Settings', to: `${base}/settings/general` },
      { key: 'sec', label: sectionLabel },
    ]
  }

  if (pathname === base || pathname === `${base}/`) {
    return [courseCrumb(courseCode, false)]
  }

  if (pathname === `${base}/feed`) {
    return [courseCrumb(courseCode, true), { key: 'feed', label: 'Feed' }]
  }
  if (pathname === `${base}/syllabus`) {
    return [courseCrumb(courseCode, true), { key: 'syl', label: 'Syllabus' }]
  }
  if (pathname === `${base}/modules`) {
    return [courseCrumb(courseCode, true), { key: 'mod', label: 'Modules' }]
  }
  if (pathname === `${base}/questions`) {
    return [courseCrumb(courseCode, true), { key: 'qb', label: 'Question bank' }]
  }
  if (pathname === `${base}/notebook`) {
    return [courseCrumb(courseCode, true), { key: 'nb', label: 'Notebook' }]
  }
  if (pathname === `${base}/calendar`) {
    return [courseCrumb(courseCode, true), { key: 'cal', label: 'Calendar' }]
  }
  if (pathname === `${base}/my-grades`) {
    return [courseCrumb(courseCode, true), { key: 'mg', label: 'My grades' }]
  }
  if (pathname === `${base}/gradebook`) {
    return [courseCrumb(courseCode, true), { key: 'gb', label: 'Gradebook' }]
  }
  if (pathname === `${base}/standards-gradebook`) {
    return [courseCrumb(courseCode, true), { key: 'sgb', label: 'Standards gradebook' }]
  }
  if (pathname === `${base}/standards-coverage`) {
    return [courseCrumb(courseCode, true), { key: 'st', label: 'Standards coverage' }]
  }
  if (pathname === `${base}/enrollments`) {
    return [courseCrumb(courseCode, true), { key: 'enr', label: 'Enrollments' }]
  }

  const modItem = matchModuleItemRoute(pathname)
  if (modItem && modItem.code === courseCode) {
    return [
      courseCrumb(courseCode, true),
      { key: 'modules', label: 'Modules', to: `${base}/modules` },
      { key: 'modname', label: '\u00a0', to: `${base}/modules` },
      { key: 'item', label: '…' },
    ]
  }

  return []
}

function mergeCourseTitle(crumbs: Crumb[], courseTitle: string | null, courseCode: string): Crumb[] {
  return crumbs.map((c) =>
    c.key === 'course' ? { ...c, label: courseTitle?.trim() || courseCode } : c,
  )
}

function mergeModuleItem(
  crumbs: Crumb[],
  moduleTitle: string | null,
  itemTitle: string,
): Crumb[] {
  return crumbs.map((c) => {
    if (c.key === 'modname') {
      if (moduleTitle) return { ...c, label: moduleTitle, to: c.to }
      return { ...c, label: '', to: undefined }
    }
    if (c.key === 'item') return { ...c, label: itemTitle }
    return c
  }).filter((c) => c.label.trim().length > 0)
}

const MODULE_ITEM_PATTERNS = [
  '/courses/:courseCode/modules/content/:itemId',
  '/courses/:courseCode/modules/assignment/:itemId',
  '/courses/:courseCode/modules/quiz/:itemId',
  '/courses/:courseCode/modules/external-link/:itemId',
] as const

function matchModuleItemRoute(pathname: string): { code: string; id: string } | null {
  for (const p of MODULE_ITEM_PATTERNS) {
    const m = matchPath({ path: p, end: true }, pathname)
    if (m?.params.itemId && m.params.courseCode) {
      return { code: m.params.courseCode, id: m.params.itemId }
    }
  }
  return null
}

export function TopBarBreadcrumbs() {
  const { pathname } = useLocation()
  const courseCode = useMemo(() => {
    const m = matchPath({ path: '/courses/:courseCode/*', end: false }, pathname)
    return m?.params.courseCode ?? null
  }, [pathname])

  const [courseTitle, setCourseTitle] = useState<string | null>(() =>
    courseCode ? courseTitleCache.get(courseCode) ?? null : null,
  )

  const [itemTrail, setItemTrail] = useState<{ moduleTitle: string | null; itemTitle: string } | null>(
    null,
  )

  useEffect(() => {
    if (!courseCode) {
      setCourseTitle(null)
      return
    }
    const cached = courseTitleCache.get(courseCode)
    if (cached) {
      setCourseTitle(cached)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const c = await fetchCourse(courseCode)
        if (cancelled) return
        courseTitleCache.set(courseCode, c.title)
        setCourseTitle(c.title)
      } catch {
        if (!cancelled) setCourseTitle(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [courseCode])

  useEffect(() => {
    const picked = matchModuleItemRoute(pathname)
    if (!picked?.code || !picked.id) {
      setItemTrail(null)
      return
    }
    const { code, id } = picked
    const cached = structureCache.get(code)
    if (cached) {
      setItemTrail(findItemModuleTitles(cached, id))
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const items = await fetchCourseStructure(code)
        if (cancelled) return
        structureCache.set(code, items)
        setItemTrail(findItemModuleTitles(items, id))
      } catch {
        if (!cancelled) setItemTrail({ moduleTitle: null, itemTitle: 'Item' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pathname])

  const crumbs = useMemo(() => {
    let base = staticCrumbsFromPathname(pathname, courseCode)
    if (courseCode && base.some((c) => c.key === 'course')) {
      base = mergeCourseTitle(base, courseTitle, courseCode)
    }
    if (itemTrail && base.some((c) => c.key === 'item')) {
      base = mergeModuleItem(base, itemTrail.moduleTitle, itemTrail.itemTitle)
    }
    return base
  }, [pathname, courseCode, courseTitle, itemTrail])

  if (!crumbs.length) return null

  return (
    <nav aria-label="Breadcrumb" className="min-w-0 flex-1 basis-0 overflow-hidden pl-1 sm:pl-0">
      <ol className="m-0 flex list-none items-center gap-0.5 p-0 text-xs text-slate-600 sm:text-sm dark:text-neutral-400">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1
          return (
            <li key={c.key + String(i)} className="flex min-w-0 items-center gap-0.5">
              {i > 0 ? (
                <ChevronRight
                  className="h-3.5 w-3.5 shrink-0 text-slate-300 dark:text-neutral-600"
                  aria-hidden
                />
              ) : null}
              {last || !c.to ? (
                <span
                  className={`truncate ${last ? 'font-medium text-slate-900 dark:text-neutral-100' : ''}`}
                  aria-current={last ? 'page' : undefined}
                >
                  {c.label}
                </span>
              ) : (
                <Link
                  to={c.to}
                  className="truncate transition hover:text-indigo-600 dark:hover:text-indigo-400"
                >
                  {c.label}
                </Link>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
