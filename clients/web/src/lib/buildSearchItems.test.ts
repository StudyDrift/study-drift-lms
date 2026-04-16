import { describe, expect, it } from 'vitest'
import {
  courseEnrollmentsReadPermission,
  courseGradebookViewPermission,
  courseItemCreatePermission,
} from './coursesApi'
import { buildSearchItems, filterSearchItems, SEARCH_GROUP_LABEL } from './buildSearchItems'
import { PERM_COURSE_CREATE, PERM_RBAC_MANAGE } from './rbacApi'
import type { SearchCourseItem, SearchPersonItem } from './searchApi'

const allowsNone = () => false
const allowsAll = (perm: string) =>
  perm === PERM_COURSE_CREATE || perm === PERM_RBAC_MANAGE

describe('buildSearchItems', () => {
  const courses: SearchCourseItem[] = [
    { courseCode: 'CS-101', title: 'Intro' },
    { courseCode: 'a/b', title: 'Encoded' },
  ]
  const people: SearchPersonItem[] = [
    {
      userId: 'u1',
      email: 'a@x.com',
      displayName: 'Alice',
      role: 'student',
      courseCode: 'CS-101',
      courseTitle: 'Intro',
    },
    {
      userId: 'u2',
      email: 'b@x.com',
      displayName: null,
      role: 'ta',
      courseCode: 'CS-101',
      courseTitle: 'Intro',
    },
  ]

  it('includes course and person rows with expected paths and haystack', () => {
    const allowsRoster = (p: string) => p === courseEnrollmentsReadPermission('CS-101')
    const items = buildSearchItems(courses, people, allowsRoster)
    const course = items.find((i) => i.id === 'course:CS-101')
    expect(course).toMatchObject({
      group: 'course',
      path: '/courses/CS-101',
      title: 'Intro',
      subtitle: 'CS-101',
    })
    expect(course?.haystack).toContain('intro')
    expect(course?.haystack).toContain('cs-101')

    const person = items.find((i) => i.id === 'person:u1:CS-101')
    expect(person).toMatchObject({
      group: 'person',
      path: '/courses/CS-101/enrollments',
      title: 'Alice',
    })

    const emailOnly = items.find((i) => i.id === 'person:u2:CS-101')
    expect(emailOnly?.title).toBe('b@x.com')
  })

  it('URL-encodes course codes in paths', () => {
    const items = buildSearchItems(courses, [], allowsNone)
    const enc = items.find((i) => i.id === 'course:a/b')
    expect(enc?.path).toBe('/courses/a%2Fb')
  })

  it('adds global page entries for every user', () => {
    const items = buildSearchItems([], [], allowsNone)
    const dashboard = items.find((i) => i.path === '/')
    expect(dashboard?.group).toBe('page')
    expect(items.some((i) => i.path === '/courses')).toBe(true)
    expect(items.some((i) => i.path === '/notebooks')).toBe(true)
    expect(items.some((i) => i.path === '/settings/ai/models')).toBe(false)
  })

  it('adds system settings pages when PERM_RBAC_MANAGE is allowed', () => {
    const allowed = (p: string) => p === PERM_RBAC_MANAGE
    const items = buildSearchItems([], [], allowed)
    expect(items.some((i) => i.path === '/settings/roles')).toBe(true)
    expect(items.some((i) => i.path === '/settings/ai/models')).toBe(true)
    expect(items.some((i) => i.path === '/settings/ai/system-prompts')).toBe(true)
  })

  it('omits system settings pages without rbac permission', () => {
    const items = buildSearchItems([], [], allowsNone)
    expect(items.some((i) => i.path === '/settings/roles')).toBe(false)
    expect(items.some((i) => i.path === '/settings/ai/models')).toBe(false)
    expect(items.some((i) => i.path === '/settings/ai/system-prompts')).toBe(false)
  })

  it('adds Create course action when PERM_COURSE_CREATE is allowed', () => {
    const allowed = (p: string) => p === PERM_COURSE_CREATE
    const items = buildSearchItems([], [], allowed)
    const create = items.find((i) => i.id === 'action:/courses/create')
    expect(create?.group).toBe('action')
    expect(create?.path).toBe('/courses/create')
  })

  it('adds per-course page shortcuts and enrollment actions', () => {
    const allowsRosterX = (p: string) => p === courseEnrollmentsReadPermission('X')
    const items = buildSearchItems([{ courseCode: 'X', title: 'Y' }], [], allowsRosterX)
    expect(items.some((i) => i.path === '/courses/X/syllabus')).toBe(true)
    expect(items.some((i) => i.path === '/courses/X/feed')).toBe(true)
    expect(items.some((i) => i.path === '/courses/X/notebook')).toBe(true)
    expect(items.some((i) => i.path === '/courses/X/my-grades')).toBe(true)
    const add = items.find((i) => i.id === 'action:/courses/X/enrollments:add')
    expect(add?.group).toBe('action')
    expect(add?.path).toBe('/courses/X/enrollments')
  })

  it('omits gradebook page without per-course gradebook permission', () => {
    const allowsRosterX = (p: string) => p === courseEnrollmentsReadPermission('X')
    const items = buildSearchItems([{ courseCode: 'X', title: 'Y' }], [], allowsRosterX)
    expect(items.some((i) => i.path === '/courses/X/gradebook')).toBe(false)
  })

  it('omits enrollments page and add-people action without roster permission', () => {
    const items = buildSearchItems([{ courseCode: 'X', title: 'Y' }], [], allowsNone)
    expect(items.some((i) => i.path === '/courses/X/enrollments')).toBe(false)
    expect(items.some((i) => i.id === 'action:/courses/X/enrollments:add')).toBe(false)
  })

  it('adds searchable course settings sections for dates and branding when staff may edit course', () => {
    const allowsItemsX = (p: string) => p === courseItemCreatePermission('X')
    const items = buildSearchItems([{ courseCode: 'X', title: 'Y' }], [], allowsItemsX)
    expect(items.some((i) => i.path === '/courses/X/settings/dates')).toBe(true)
    expect(items.some((i) => i.path === '/courses/X/settings/branding')).toBe(true)
    const noItems = buildSearchItems([{ courseCode: 'X', title: 'Y' }], [], allowsNone)
    expect(noItems.some((i) => i.path === '/courses/X/settings/dates')).toBe(false)
    expect(noItems.some((i) => i.path === '/courses/X/settings/branding')).toBe(false)
  })

  it('includes grading settings page only when gradebook view is granted', () => {
    const allowsGradeG = (p: string) => p === courseGradebookViewPermission('G')
    const items = buildSearchItems([{ courseCode: 'G', title: 'H' }], [], allowsGradeG)
    expect(items.some((i) => i.path === '/courses/G/settings/grading')).toBe(true)
    const noGrade = buildSearchItems([{ courseCode: 'G', title: 'H' }], [], allowsNone)
    expect(noGrade.some((i) => i.path === '/courses/G/settings/grading')).toBe(false)
  })

  it('includes export-import and archived settings when item:create is granted', () => {
    const allowsItems = (p: string) => p === courseItemCreatePermission('Z')
    const items = buildSearchItems([{ courseCode: 'Z', title: 'W' }], [], allowsItems)
    expect(items.some((i) => i.path === '/courses/Z/settings/export-import')).toBe(true)
    expect(items.some((i) => i.path === '/courses/Z/settings/archived')).toBe(true)
  })

  it('omits export-import and archived settings without item:create', () => {
    const items = buildSearchItems([{ courseCode: 'Z', title: 'W' }], [], allowsNone)
    expect(items.some((i) => i.path === '/courses/Z/settings/export-import')).toBe(false)
    expect(items.some((i) => i.path === '/courses/Z/settings/archived')).toBe(false)
  })

  it('includes gradebook page only for courses where gradebook view is granted', () => {
    const courses: SearchCourseItem[] = [
      { courseCode: 'C-ONE', title: 'First' },
      { courseCode: 'C-TWO', title: 'Second' },
    ]
    const allowsGradebookOne = (p: string) => p === courseGradebookViewPermission('C-ONE')
    const items = buildSearchItems(courses, [], allowsGradebookOne)
    expect(items.some((i) => i.path === '/courses/C-ONE/gradebook')).toBe(true)
    expect(items.some((i) => i.path === '/courses/C-TWO/gradebook')).toBe(false)
  })
})

describe('filterSearchItems', () => {
  it('returns all items when query is empty or whitespace', () => {
    const items = buildSearchItems(
      [{ courseCode: 'A', title: 'Alpha' }],
      [],
      allowsNone,
    )
    expect(filterSearchItems(items, '').length).toBe(items.length)
    expect(filterSearchItems(items, '   ').length).toBe(items.length)
  })

  it('matches every word (AND) against haystack', () => {
    const items = buildSearchItems(
      [{ courseCode: 'Z', title: 'Beta Course' }],
      [],
      allowsNone,
    )
    const course = items.find((i) => i.group === 'course')!
    expect(filterSearchItems(items, 'beta z').map((i) => i.id)).toContain(course.id)
    expect(filterSearchItems(items, 'beta missingword').length).toBe(0)
  })

  it('sorts by group order then title', () => {
    const items: Parameters<typeof filterSearchItems>[0] = [
      {
        id: 'p1',
        group: 'page',
        title: 'Z Page',
        subtitle: '',
        path: '/z',
        haystack: 'z page',
      },
      {
        id: 'a1',
        group: 'action',
        title: 'A Action',
        subtitle: '',
        path: '/a',
        haystack: 'a action',
      },
      {
        id: 'c1',
        group: 'course',
        title: 'C Course',
        subtitle: '',
        path: '/c',
        haystack: 'c course',
      },
    ]
    const sorted = filterSearchItems(items, '')
    expect(sorted.map((i) => i.id)).toEqual(['a1', 'c1', 'p1'])
  })
})

describe('SEARCH_GROUP_LABEL', () => {
  it('has a label for each group', () => {
    expect(SEARCH_GROUP_LABEL.action).toBe('Actions')
    expect(SEARCH_GROUP_LABEL.course).toBe('Courses')
    expect(SEARCH_GROUP_LABEL.person).toBe('People')
    expect(SEARCH_GROUP_LABEL.page).toBe('Pages')
  })
})

describe('buildSearchItems with full permissions', () => {
  it('includes rbac page and create course when allows returns true', () => {
    const items = buildSearchItems([], [], allowsAll)
    expect(items.some((i) => i.path === '/settings/roles')).toBe(true)
    expect(items.some((i) => i.path === '/settings/ai/models')).toBe(true)
    expect(items.some((i) => i.id === 'action:/courses/create')).toBe(true)
  })
})
