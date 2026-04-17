import { authorizedFetch } from './api'
import { getAccessToken } from './auth'
import { readApiErrorMessage } from './errors'

import type { MarkdownThemeCustom } from './markdownTheme'

export type Course = {
  id: string
  courseCode: string
  title: string
  description: string
  heroImageUrl: string | null
  /** CSS `object-position` for cropped banners (e.g. `50% 30%`). */
  heroImageObjectPosition: string | null
  startsAt: string | null
  endsAt: string | null
  visibleFrom: string | null
  hiddenAt: string | null
  /** `fixed` (calendar) or `relative` (per-student enrollment). */
  scheduleMode?: string
  /** ISO 8601 duration from enrollment (e.g. P90D) when relative. */
  relativeEndAfter?: string | null
  relativeHiddenAfter?: string | null
  relativeScheduleAnchorAt?: string | null
  published: boolean
  /** When true, the course is omitted from `/api/v1/courses` and search. */
  archived: boolean
  markdownThemePreset: string
  markdownThemeCustom: MarkdownThemeCustom | null
  /** Display grading scale id (matches server `GRADING_SCALES`). */
  gradingScale: string
  createdAt: string
  updatedAt: string
  /** Present on single-course GET: raw enrollment roles for the viewer (`teacher`, `student`, …). */
  viewerEnrollmentRoles?: string[]
}

/** Server `course::GRADING_SCALES` — keep in sync for labels and validation. */
export const GRADING_SCALE_OPTIONS: { id: string; label: string; description: string }[] = [
  {
    id: 'letter_standard',
    label: 'Letter grades (A–F)',
    description: 'Standard A through F without plus/minus.',
  },
  {
    id: 'letter_plus_minus',
    label: 'Letter grades with ±',
    description: 'Includes A+, B−, and similar variants.',
  },
  { id: 'percent', label: 'Percent (0–100)', description: 'Numeric percentage only.' },
  { id: 'pass_fail', label: 'Pass / Fail', description: 'Pass or fail outcomes only.' },
]

export type AssignmentGroup = {
  id: string
  sortOrder: number
  name: string
  weightPercent: number
}

export type CourseGradingSettings = {
  gradingScale: string
  assignmentGroups: AssignmentGroup[]
}

/** Normalizes GET/PUT `/grading` JSON (camelCase or snake_case) without throwing on odd shapes. */
export function parseCourseGradingSettings(raw: unknown): CourseGradingSettings {
  if (!raw || typeof raw !== 'object') {
    return { gradingScale: 'letter_standard', assignmentGroups: [] }
  }
  const o = raw as Record<string, unknown>
  const gradingScale =
    typeof o.gradingScale === 'string'
      ? o.gradingScale
      : typeof o.grading_scale === 'string'
        ? o.grading_scale
        : 'letter_standard'
  const rawGroups = o.assignmentGroups ?? o.assignment_groups
  const assignmentGroups: AssignmentGroup[] = []
  if (Array.isArray(rawGroups)) {
    for (const item of rawGroups) {
      if (!item || typeof item !== 'object') continue
      const g = item as Record<string, unknown>
      const idVal = g.id
      const id =
        typeof idVal === 'string'
          ? idVal.trim()
          : idVal != null && typeof idVal !== 'object'
            ? String(idVal).trim()
            : ''
      const name = typeof g.name === 'string' ? g.name.trim() : ''
      const sortOrder =
        typeof g.sortOrder === 'number' && Number.isFinite(g.sortOrder)
          ? g.sortOrder
          : typeof g.sort_order === 'number' && Number.isFinite(g.sort_order)
            ? g.sort_order
            : 0
      const weightRaw = g.weightPercent ?? g.weight_percent
      let weightPercent = 0
      if (typeof weightRaw === 'number' && Number.isFinite(weightRaw)) {
        weightPercent = weightRaw
      } else if (typeof weightRaw === 'string') {
        const n = Number.parseFloat(weightRaw)
        weightPercent = Number.isFinite(n) ? n : 0
      }
      if (!id || !name) continue
      assignmentGroups.push({ id, name, sortOrder, weightPercent })
    }
  }
  return { gradingScale, assignmentGroups }
}

export async function fetchCourse(courseCode: string): Promise<Course> {
  const res = await authorizedFetch(`/api/v1/courses/${encodeURIComponent(courseCode)}`)
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw as Course
}

/** Persist display order for the signed-in user's course catalog (`PUT /api/v1/courses/catalog-order`). */
export async function putCourseCatalogOrder(courseIds: string[]): Promise<void> {
  const res = await authorizedFetch('/api/v1/courses/catalog-order', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ courseIds }),
  })
  if (res.ok) return
  const raw = await parseJson(res)
  throw new Error(readApiErrorMessage(raw))
}

export async function patchCourseArchived(
  courseCode: string,
  archived: boolean,
): Promise<Course> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/archived`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived }),
    },
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw as Course
}

/** Permanently removes module content, syllabus, files, and related data; course shell remains. */
export async function postFactoryResetCourse(courseCode: string): Promise<Course> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/factory-reset`,
    { method: 'POST' },
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw as Course
}

export async function patchCourseMarkdownTheme(
  courseCode: string,
  body: { preset: string; custom?: MarkdownThemeCustom | null },
): Promise<Course> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/markdown-theme`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        preset: body.preset,
        custom: body.custom ?? null,
      }),
    },
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw as Course
}

async function parseJson(res: Response): Promise<unknown> {
  return res.json().catch(() => ({}))
}

export type CourseFileUploadResponse = {
  id: string
  /** Path-only URL (`/api/v1/courses/.../course-files/.../content`). */
  contentPath: string
  mimeType: string
  byteSize: number
}

/** Multipart upload of an image into the course file store (`POST .../course-files`). */
export async function uploadCourseFile(courseCode: string, file: File): Promise<CourseFileUploadResponse> {
  const body = new FormData()
  body.append('file', file)
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/course-files`,
    { method: 'POST', body },
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  const o = raw as {
    id: string
    content_path: string
    mime_type: string
    byte_size: number
  }
  return {
    id: o.id,
    contentPath: o.content_path,
    mimeType: o.mime_type,
    byteSize: o.byte_size,
  }
}

export async function createCourse(body: {
  title: string
  description: string
}): Promise<Course> {
  const res = await authorizedFetch('/api/v1/courses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw as Course
}

/**
 * `course:<courseId>:item:create` — `courseId` is the course code (e.g. `C-ABC123`), matching
 * `course_grants::course_item_create_permission` on the server.
 */
export function courseItemCreatePermission(courseId: string): string {
  return `course:${courseId}:item:create`
}

/**
 * `course:<courseCode>:items:create` — quiz question bank and related editor actions (More menu,
 * Edit questions), merged via `user_course_grants` like `courseItemCreatePermission`.
 */
export function courseItemsCreatePermission(courseCode: string): string {
  return `course:${courseCode}:items:create`
}

/** `course:<courseCode>:gradebook:view` — course gradebook access for that course. */
export function courseGradebookViewPermission(courseCode: string): string {
  return `course:${courseCode}:gradebook:view`
}

/** `course:<courseCode>:enrollments:read` — view course roster (names and roles). */
export function courseEnrollmentsReadPermission(courseCode: string): string {
  return `course:${courseCode}:enrollments:read`
}

/** `course:<courseCode>:enrollments:update` — change roster rows for that course (e.g. remove a role). */
export function courseEnrollmentsUpdatePermission(courseCode: string): string {
  return `course:${courseCode}:enrollments:update`
}

export type EnrollmentGroupMembership = {
  groupSetId: string
  groupId: string
}

export type EnrollmentGroupTree = {
  id: string
  name: string
  sortOrder: number
  enrollmentIds: string[]
}

export type EnrollmentGroupSetTree = {
  id: string
  name: string
  sortOrder: number
  groups: EnrollmentGroupTree[]
}

export type EnrollmentGroupsTreeResponse = {
  groupSets: EnrollmentGroupSetTree[]
}

export async function postEnrollmentGroupsEnable(courseCode: string): Promise<void> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/enrollment-groups/enable`,
    { method: 'POST' },
  )
  if (!res.ok) {
    const raw: unknown = await res.json().catch(() => ({}))
    throw new Error(readApiErrorMessage(raw))
  }
}

export async function fetchEnrollmentGroupsTree(
  courseCode: string,
): Promise<EnrollmentGroupsTreeResponse> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/enrollment-groups`,
  )
  const raw: unknown = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw as EnrollmentGroupsTreeResponse
}

export async function postEnrollmentGroupSet(courseCode: string, name: string): Promise<string> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/enrollment-groups/sets`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    },
  )
  const raw: unknown = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  const id = (raw as { id?: string }).id
  if (!id) throw new Error('Invalid response.')
  return id
}

export async function postEnrollmentGroupInSet(
  courseCode: string,
  setId: string,
  name: string,
): Promise<string> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/enrollment-groups/sets/${encodeURIComponent(setId)}/groups`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    },
  )
  const raw: unknown = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  const id = (raw as { id?: string }).id
  if (!id) throw new Error('Invalid response.')
  return id
}

export async function patchEnrollmentGroupSetName(
  courseCode: string,
  setId: string,
  name: string,
): Promise<void> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/enrollment-groups/sets/${encodeURIComponent(setId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    },
  )
  if (!res.ok) {
    const raw: unknown = await res.json().catch(() => ({}))
    throw new Error(readApiErrorMessage(raw))
  }
}

export async function patchEnrollmentGroupName(
  courseCode: string,
  groupId: string,
  name: string,
): Promise<void> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/enrollment-groups/groups/${encodeURIComponent(groupId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    },
  )
  if (!res.ok) {
    const raw: unknown = await res.json().catch(() => ({}))
    throw new Error(readApiErrorMessage(raw))
  }
}

export async function deleteEnrollmentGroupSet(courseCode: string, setId: string): Promise<void> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/enrollment-groups/sets/${encodeURIComponent(setId)}`,
    { method: 'DELETE' },
  )
  if (!res.ok) {
    const raw: unknown = await res.json().catch(() => ({}))
    throw new Error(readApiErrorMessage(raw))
  }
}

export async function deleteEnrollmentGroup(courseCode: string, groupId: string): Promise<void> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/enrollment-groups/groups/${encodeURIComponent(groupId)}`,
    { method: 'DELETE' },
  )
  if (!res.ok) {
    const raw: unknown = await res.json().catch(() => ({}))
    throw new Error(readApiErrorMessage(raw))
  }
}

export async function putEnrollmentGroupMembership(
  courseCode: string,
  body: { enrollmentId: string; groupSetId: string; groupId: string | null },
): Promise<void> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/enrollment-groups/memberships`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
  if (!res.ok) {
    const raw: unknown = await res.json().catch(() => ({}))
    throw new Error(readApiErrorMessage(raw))
  }
}

/**
 * Same idea as the server course GET `student_only` flag: the viewer is enrolled as `student`
 * and has no teacher/instructor/ta enrollment in this course. Dual teacher+student rows are
 * **not** learner-only. Role strings are compared case-insensitively. Empty/missing roles are
 * treated as learner-only so roster UI stays hidden until we know otherwise.
 */
export function viewerIsLearnerOnlyCourseEnrollment(
  viewerEnrollmentRoles: readonly string[] | null | undefined,
): boolean {
  if (!viewerEnrollmentRoles?.length) return true
  const roles = viewerEnrollmentRoles.map((r) => r.trim().toLowerCase())
  const hasStudent = roles.includes('student')
  const hasStaff = roles.some((r) => r === 'teacher' || r === 'instructor' || r === 'ta')
  return hasStudent && !hasStaff
}

/**
 * Matches server `enrollment::user_is_course_staff`: enrolled as `teacher` or `instructor` for this
 * course. Use for roster/Enrollments UI — do not rely on permission strings alone (wildcards can
 * match students).
 */
export function viewerIsCourseStaffEnrollment(
  viewerEnrollmentRoles: readonly string[] | null | undefined,
): boolean {
  if (!viewerEnrollmentRoles?.length) return false
  const roles = viewerEnrollmentRoles.map((r) => r.trim().toLowerCase())
  return roles.some((r) => r === 'teacher' || r === 'instructor')
}

/** Hide course roster / Enrollments navigation for learners and when staff preview as a student. */
export function viewerShouldHideCourseEnrollmentsNav(
  viewerEnrollmentRoles: readonly string[] | null | undefined,
  courseViewPreview: 'teacher' | 'student',
): boolean {
  if (courseViewPreview === 'student') return true
  return viewerIsLearnerOnlyCourseEnrollment(viewerEnrollmentRoles)
}

/**
 * Show “My grades” whenever “View as: Student” is active (staff preview), or when the viewer
 * has a real student enrollment in this course (including dual student+staff enrollment).
 * While enrollment roles are still loading (`null`), returns false so the nav does not flash on.
 */
export function viewerShouldShowMyGradesNav(
  viewerEnrollmentRoles: readonly string[] | null | undefined,
  courseViewPreview: 'teacher' | 'student',
): boolean {
  if (courseViewPreview === 'student') return true
  if (viewerEnrollmentRoles == null) return false
  if (!viewerEnrollmentRoles.length) return false
  const roles = viewerEnrollmentRoles.map((r) => r.trim().toLowerCase())
  return roles.includes('student') && !roles.some((r) => r === 'teacher' || r === 'instructor' || r === 'ta')
}

export type CourseStructureItem = {
  id: string
  sortOrder: number
  kind: 'module' | 'heading' | 'content_page' | 'assignment' | 'quiz' | 'external_link'
  title: string
  /** Set when this row is nested under a module. */
  parentId: string | null
  /** Module: when false, students do not see this module or its children. Child row: when false, students do not see that item (staff still do). */
  published: boolean
  /** Module rows: optional UTC instant — students only see the module on or after this time. */
  visibleFrom: string | null
  /** Child items: when true, omitted from `fetchCourseStructure`; staff uses `fetchCourseArchivedStructure`. */
  archived?: boolean
  /** Content pages: optional due time for calendar / assignments. */
  dueAt: string | null
  /** Which assignment group this gradable item counts toward (course grading settings). */
  assignmentGroupId: string | null
  /** Quiz items only: true when the quiz is in adaptive mode. */
  isAdaptive?: boolean
  /** Non-adaptive quizzes only: sum of per-question points from the course structure API. */
  pointsPossible?: number
  /** Quizzes and assignments: instructor-set gradebook points when set. */
  pointsWorth?: number | null
  /** External link module items: destination URL when set. */
  externalUrl?: string | null
  createdAt: string
  updatedAt: string
}

export async function fetchCourseStructure(courseCode: string): Promise<CourseStructureItem[]> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/structure`,
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  const body = raw as { items: CourseStructureItem[] }
  return body.items
}

/** GET `/gradebook/grid` — enrolled students and gradable module items (assignments and quizzes). */
export type CourseGradebookGridStudent = {
  userId: string
  displayName: string
}

export type CourseGradebookGridColumn = {
  id: string
  kind: string
  title: string
  maxPoints: number | null
  assignmentGroupId?: string | null
}

export type CourseGradebookGridResponse = {
  students: CourseGradebookGridStudent[]
  columns: CourseGradebookGridColumn[]
  /** Saved scores keyed by student user id, then module item id. */
  grades?: Record<string, Record<string, string>>
}

export async function fetchCourseGradebookGrid(courseCode: string): Promise<CourseGradebookGridResponse> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/gradebook/grid`,
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  const body = raw as {
    students?: CourseGradebookGridStudent[]
    columns?: CourseGradebookGridColumn[]
    grades?: Record<string, Record<string, string>>
  }
  return {
    students: body.students ?? [],
    columns: body.columns ?? [],
    grades: body.grades,
  }
}

/** GET `/my-grades` — current user’s grades (enrolled as student only). */
export type CourseMyGradesResponse = {
  columns: CourseGradebookGridColumn[]
  grades: Record<string, string>
  assignmentGroups: AssignmentGroup[]
}

export async function fetchCourseMyGrades(courseCode: string): Promise<CourseMyGradesResponse> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/my-grades`,
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  const body = raw as {
    columns?: CourseGradebookGridColumn[]
    grades?: Record<string, string>
    assignmentGroups?: unknown
  }
  const parsed = parseCourseGradingSettings({ assignmentGroups: body.assignmentGroups })
  return {
    columns: body.columns ?? [],
    grades: body.grades ?? {},
    assignmentGroups: parsed.assignmentGroups,
  }
}

/** PUT `/gradebook/grades` — bulk upsert/clear cells (`course:<code>:item:create`). */
export async function putCourseGradebookGrades(
  courseCode: string,
  grades: Record<string, Record<string, string>>,
): Promise<void> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/gradebook/grades`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grades }),
    },
  )
  if (res.ok) return
  const raw = await parseJson(res)
  throw new Error(readApiErrorMessage(raw))
}

/** Staff only: archived module items and their parent modules (for Settings → Archived). */
export async function fetchCourseArchivedStructure(
  courseCode: string,
): Promise<CourseStructureItem[]> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/structure/archived`,
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  const body = raw as { items: CourseStructureItem[] }
  return body.items
}

export async function reorderCourseStructure(
  courseCode: string,
  body: { moduleOrder: string[]; childOrderByModule: Record<string, string[]> },
): Promise<CourseStructureItem[]> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/structure/reorder`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  const data = raw as { items: CourseStructureItem[] }
  return data.items
}

export async function patchCourseStructureItem(
  courseCode: string,
  itemId: string,
  body: { title?: string; published?: boolean; archived?: boolean },
): Promise<CourseStructureItem> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/structure/items/${encodeURIComponent(itemId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw as CourseStructureItem
}

/** Reschedule due date only; server requires `course:<code>:items:create`. */
export async function patchCourseStructureItemDueAt(
  courseCode: string,
  itemId: string,
  body: { dueAt: string },
): Promise<void> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/structure/items/${encodeURIComponent(itemId)}/due-at`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dueAt: body.dueAt }),
    },
  )
  if (!res.ok) {
    const raw = await parseJson(res)
    throw new Error(readApiErrorMessage(raw))
  }
}

export async function unarchiveCourseStructureItem(
  courseCode: string,
  itemId: string,
): Promise<CourseStructureItem> {
  return patchCourseStructureItem(courseCode, itemId, { archived: false })
}

export async function archiveCourseStructureItem(courseCode: string, itemId: string): Promise<void> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/structure/items/${encodeURIComponent(itemId)}`,
    { method: 'DELETE' },
  )
  if (res.ok) return
  const raw = await parseJson(res)
  throw new Error(readApiErrorMessage(raw))
}

export async function patchCourseModule(
  courseCode: string,
  moduleId: string,
  body: { title: string; published: boolean; visibleFrom: string | null },
): Promise<CourseStructureItem> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/structure/modules/${encodeURIComponent(moduleId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: body.title,
        published: body.published,
        visibleFrom: body.visibleFrom,
      }),
    },
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw as CourseStructureItem
}

export async function createCourseModule(
  courseCode: string,
  body: { title: string },
): Promise<CourseStructureItem> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/structure/modules`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw as CourseStructureItem
}

export async function createModuleHeading(
  courseCode: string,
  moduleId: string,
  body: { title: string },
): Promise<CourseStructureItem> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/structure/modules/${encodeURIComponent(moduleId)}/headings`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw as CourseStructureItem
}

export type ModuleContentPagePayload = {
  itemId: string
  title: string
  markdown: string
  dueAt: string | null
  /** Present for assignments; always null for content pages. */
  pointsWorth: number | null
  /** Present for assignments; null when unset. */
  assignmentGroupId: string | null
  updatedAt: string
  /** Assignment: visibility start (ISO). */
  availableFrom: string | null
  /** Assignment: visibility end (ISO). */
  availableUntil: string | null
  requiresAssignmentAccessCode: boolean
  /** Instructors only when set. */
  assignmentAccessCode: string | null
  submissionAllowText: boolean
  submissionAllowFileUpload: boolean
  submissionAllowUrl: boolean
}

function normalizeModuleContentPagePayload(raw: unknown): ModuleContentPagePayload {
  const r = raw as Record<string, unknown>
  return {
    itemId: String(r.itemId ?? ''),
    title: String(r.title ?? ''),
    markdown: String(r.markdown ?? ''),
    dueAt: (r.dueAt as string | null | undefined) ?? null,
    pointsWorth: typeof r.pointsWorth === 'number' ? r.pointsWorth : null,
    assignmentGroupId: typeof r.assignmentGroupId === 'string' ? r.assignmentGroupId : null,
    updatedAt: String(r.updatedAt ?? ''),
    availableFrom: typeof r.availableFrom === 'string' ? r.availableFrom : null,
    availableUntil: typeof r.availableUntil === 'string' ? r.availableUntil : null,
    requiresAssignmentAccessCode: Boolean(r.requiresAssignmentAccessCode),
    assignmentAccessCode:
      typeof r.assignmentAccessCode === 'string' ? r.assignmentAccessCode : null,
    submissionAllowText: r.submissionAllowText !== false,
    submissionAllowFileUpload: Boolean(r.submissionAllowFileUpload),
    submissionAllowUrl: Boolean(r.submissionAllowUrl),
  }
}

export async function createModuleAssignment(
  courseCode: string,
  moduleId: string,
  body: { title: string },
): Promise<CourseStructureItem> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/structure/modules/${encodeURIComponent(moduleId)}/assignments`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw as CourseStructureItem
}

export async function createModuleContentPage(
  courseCode: string,
  moduleId: string,
  body: { title: string },
): Promise<CourseStructureItem> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/structure/modules/${encodeURIComponent(moduleId)}/content-pages`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw as CourseStructureItem
}

export async function createModuleQuiz(
  courseCode: string,
  moduleId: string,
  body: { title: string },
): Promise<CourseStructureItem> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/structure/modules/${encodeURIComponent(moduleId)}/quizzes`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw as CourseStructureItem
}

export async function createModuleExternalLink(
  courseCode: string,
  moduleId: string,
  body: { title: string; url: string },
): Promise<CourseStructureItem> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/structure/modules/${encodeURIComponent(moduleId)}/external-links`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw as CourseStructureItem
}

export type ModuleExternalLinkPayload = {
  itemId: string
  title: string
  url: string
  updatedAt: string
}

function normalizeModuleExternalLinkPayload(raw: unknown): ModuleExternalLinkPayload {
  const r = raw as Record<string, unknown>
  return {
    itemId: String(r.itemId ?? ''),
    title: String(r.title ?? ''),
    url: String(r.url ?? ''),
    updatedAt: String(r.updatedAt ?? ''),
  }
}

export async function fetchModuleExternalLink(
  courseCode: string,
  itemId: string,
): Promise<ModuleExternalLinkPayload> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/external-links/${encodeURIComponent(itemId)}`,
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return normalizeModuleExternalLinkPayload(raw)
}

export async function patchModuleExternalLink(
  courseCode: string,
  itemId: string,
  body: { url: string },
): Promise<ModuleExternalLinkPayload> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/external-links/${encodeURIComponent(itemId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return normalizeModuleExternalLinkPayload(raw)
}

export type QuizQuestion = {
  id: string
  prompt: string
  questionType: 'multiple_choice' | 'fill_in_blank' | 'essay' | 'true_false' | 'short_answer'
  choices: string[]
  correctChoiceIndex: number | null
  multipleAnswer: boolean
  answerWithImage: boolean
  required: boolean
  points: number
  estimatedMinutes: number
}

export type GradeAttemptPolicy = 'highest' | 'latest' | 'first' | 'average'
export type LateSubmissionPolicy = 'allow' | 'penalty' | 'block'
export type ShowScoreTiming = 'immediate' | 'after_due' | 'manual'
export type ReviewVisibility = 'none' | 'score_only' | 'responses' | 'correct_answers' | 'full'
export type ReviewWhen = 'after_submit' | 'after_due' | 'always' | 'never'
export type AdaptiveDifficulty = 'introductory' | 'standard' | 'challenging'
export type AdaptiveStopRule = 'fixed_count' | 'mastery_estimate'

export type ModuleQuizPayload = {
  itemId: string
  title: string
  markdown: string
  dueAt: string | null
  availableFrom: string | null
  availableUntil: string | null
  unlimitedAttempts: boolean
  maxAttempts: number
  gradeAttemptPolicy: GradeAttemptPolicy
  passingScorePercent: number | null
  /** Total points this quiz counts for; null if unset. */
  pointsWorth: number | null
  lateSubmissionPolicy: LateSubmissionPolicy
  latePenaltyPercent: number | null
  timeLimitMinutes: number | null
  timerPauseWhenTabHidden: boolean
  perQuestionTimeLimitSeconds: number | null
  showScoreTiming: ShowScoreTiming
  reviewVisibility: ReviewVisibility
  reviewWhen: ReviewWhen
  oneQuestionAtATime: boolean
  shuffleQuestions: boolean
  shuffleChoices: boolean
  allowBackNavigation: boolean
  requiresQuizAccessCode: boolean
  /** Only for editors; learners never receive this field. */
  quizAccessCode?: string | null
  adaptiveDifficulty: AdaptiveDifficulty
  adaptiveTopicBalance: boolean
  adaptiveStopRule: AdaptiveStopRule
  randomQuestionPoolCount: number | null
  questions: QuizQuestion[]
  updatedAt: string
  isAdaptive: boolean
  /** Omitted for learners when the quiz is adaptive. */
  adaptiveSystemPrompt: string | null
  adaptiveSourceItemIds: string[] | null
  adaptiveQuestionCount: number
  /** Course grading category; null when unset. */
  assignmentGroupId: string | null
}

/** Editable advanced quiz options (editor draft); `quizAccessCode` is plain text for the form. */
export type QuizAdvancedSettings = Pick<
  ModuleQuizPayload,
  | 'maxAttempts'
  | 'gradeAttemptPolicy'
  | 'passingScorePercent'
  | 'lateSubmissionPolicy'
  | 'latePenaltyPercent'
  | 'timeLimitMinutes'
  | 'timerPauseWhenTabHidden'
  | 'perQuestionTimeLimitSeconds'
  | 'showScoreTiming'
  | 'reviewVisibility'
  | 'reviewWhen'
  | 'shuffleQuestions'
  | 'shuffleChoices'
  | 'allowBackNavigation'
  | 'adaptiveDifficulty'
  | 'adaptiveTopicBalance'
  | 'adaptiveStopRule'
  | 'randomQuestionPoolCount'
  | 'requiresQuizAccessCode'
> & { quizAccessCode: string }

export function defaultQuizAdvancedSettings(): QuizAdvancedSettings {
  return {
    maxAttempts: 1,
    gradeAttemptPolicy: 'latest',
    passingScorePercent: null,
    lateSubmissionPolicy: 'allow',
    latePenaltyPercent: null,
    timeLimitMinutes: null,
    timerPauseWhenTabHidden: false,
    perQuestionTimeLimitSeconds: null,
    showScoreTiming: 'immediate',
    reviewVisibility: 'full',
    reviewWhen: 'always',
    shuffleQuestions: false,
    shuffleChoices: false,
    allowBackNavigation: true,
    adaptiveDifficulty: 'standard',
    adaptiveTopicBalance: true,
    adaptiveStopRule: 'fixed_count',
    randomQuestionPoolCount: null,
    quizAccessCode: '',
    requiresQuizAccessCode: false,
  }
}

export function quizAdvancedSettingsFromPayload(data: ModuleQuizPayload): QuizAdvancedSettings {
  return {
    maxAttempts: data.maxAttempts,
    gradeAttemptPolicy: data.gradeAttemptPolicy,
    passingScorePercent: data.passingScorePercent,
    lateSubmissionPolicy: data.lateSubmissionPolicy,
    latePenaltyPercent: data.latePenaltyPercent,
    timeLimitMinutes: data.timeLimitMinutes,
    timerPauseWhenTabHidden: data.timerPauseWhenTabHidden,
    perQuestionTimeLimitSeconds: data.perQuestionTimeLimitSeconds,
    showScoreTiming: data.showScoreTiming,
    reviewVisibility: data.reviewVisibility,
    reviewWhen: data.reviewWhen,
    shuffleQuestions: data.shuffleQuestions,
    shuffleChoices: data.shuffleChoices,
    allowBackNavigation: data.allowBackNavigation,
    adaptiveDifficulty: data.adaptiveDifficulty,
    adaptiveTopicBalance: data.adaptiveTopicBalance,
    adaptiveStopRule: data.adaptiveStopRule,
    randomQuestionPoolCount: data.randomQuestionPoolCount,
    quizAccessCode: data.quizAccessCode?.trim() ?? '',
    requiresQuizAccessCode: data.requiresQuizAccessCode,
  }
}

/** Backward-compatible defaults when older API responses omit new fields. */
export function normalizeModuleQuizPayload(raw: unknown): ModuleQuizPayload {
  const r = raw as Partial<ModuleQuizPayload> & Record<string, unknown>
  return {
    itemId: String(r.itemId ?? ''),
    title: String(r.title ?? ''),
    markdown: String(r.markdown ?? ''),
    dueAt: (r.dueAt as string | null | undefined) ?? null,
    availableFrom: (r.availableFrom as string | null | undefined) ?? null,
    availableUntil: (r.availableUntil as string | null | undefined) ?? null,
    unlimitedAttempts: Boolean(r.unlimitedAttempts),
    maxAttempts: typeof r.maxAttempts === 'number' ? r.maxAttempts : 1,
    gradeAttemptPolicy: (r.gradeAttemptPolicy as GradeAttemptPolicy) ?? 'latest',
    passingScorePercent: typeof r.passingScorePercent === 'number' ? r.passingScorePercent : null,
    pointsWorth: typeof r.pointsWorth === 'number' ? r.pointsWorth : null,
    lateSubmissionPolicy: (r.lateSubmissionPolicy as LateSubmissionPolicy) ?? 'allow',
    latePenaltyPercent: typeof r.latePenaltyPercent === 'number' ? r.latePenaltyPercent : null,
    timeLimitMinutes: typeof r.timeLimitMinutes === 'number' ? r.timeLimitMinutes : null,
    timerPauseWhenTabHidden: Boolean(r.timerPauseWhenTabHidden),
    perQuestionTimeLimitSeconds:
      typeof r.perQuestionTimeLimitSeconds === 'number' ? r.perQuestionTimeLimitSeconds : null,
    showScoreTiming: (r.showScoreTiming as ShowScoreTiming) ?? 'immediate',
    reviewVisibility: (r.reviewVisibility as ReviewVisibility) ?? 'full',
    reviewWhen: (r.reviewWhen as ReviewWhen) ?? 'always',
    oneQuestionAtATime: Boolean(r.oneQuestionAtATime),
    shuffleQuestions: Boolean(r.shuffleQuestions),
    shuffleChoices: Boolean(r.shuffleChoices),
    allowBackNavigation: r.allowBackNavigation !== false,
    requiresQuizAccessCode: Boolean(r.requiresQuizAccessCode),
    quizAccessCode: r.quizAccessCode != null ? String(r.quizAccessCode) : null,
    adaptiveDifficulty: (r.adaptiveDifficulty as AdaptiveDifficulty) ?? 'standard',
    adaptiveTopicBalance: r.adaptiveTopicBalance !== false,
    adaptiveStopRule: (r.adaptiveStopRule as AdaptiveStopRule) ?? 'fixed_count',
    randomQuestionPoolCount:
      typeof r.randomQuestionPoolCount === 'number' ? r.randomQuestionPoolCount : null,
    questions: Array.isArray(r.questions) ? (r.questions as QuizQuestion[]) : [],
    updatedAt: String(r.updatedAt ?? ''),
    isAdaptive: Boolean(r.isAdaptive),
    adaptiveSystemPrompt: (r.adaptiveSystemPrompt as string | null | undefined) ?? null,
    adaptiveSourceItemIds: Array.isArray(r.adaptiveSourceItemIds)
      ? (r.adaptiveSourceItemIds as string[])
      : null,
    adaptiveQuestionCount: typeof r.adaptiveQuestionCount === 'number' ? r.adaptiveQuestionCount : 5,
    assignmentGroupId: typeof r.assignmentGroupId === 'string' ? r.assignmentGroupId : null,
  }
}

export async function fetchModuleQuiz(courseCode: string, itemId: string): Promise<ModuleQuizPayload> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/quizzes/${encodeURIComponent(itemId)}`,
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return normalizeModuleQuizPayload(raw)
}

export async function patchModuleQuiz(
  courseCode: string,
  itemId: string,
  body: {
    title?: string
    markdown?: string
    dueAt?: string | null
    availableFrom?: string | null
    availableUntil?: string | null
    unlimitedAttempts?: boolean
    maxAttempts?: number
    gradeAttemptPolicy?: GradeAttemptPolicy
    passingScorePercent?: number | null
    pointsWorth?: number | null
    lateSubmissionPolicy?: LateSubmissionPolicy
    latePenaltyPercent?: number | null
    timeLimitMinutes?: number | null
    timerPauseWhenTabHidden?: boolean
    perQuestionTimeLimitSeconds?: number | null
    showScoreTiming?: ShowScoreTiming
    reviewVisibility?: ReviewVisibility
    reviewWhen?: ReviewWhen
    oneQuestionAtATime?: boolean
    shuffleQuestions?: boolean
    shuffleChoices?: boolean
    allowBackNavigation?: boolean
    quizAccessCode?: string | null
    adaptiveDifficulty?: AdaptiveDifficulty
    adaptiveTopicBalance?: boolean
    adaptiveStopRule?: AdaptiveStopRule
    randomQuestionPoolCount?: number | null
    questions?: QuizQuestion[]
    isAdaptive?: boolean
    adaptiveSystemPrompt?: string
    adaptiveSourceItemIds?: string[]
    adaptiveQuestionCount?: number
  },
): Promise<ModuleQuizPayload> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/quizzes/${encodeURIComponent(itemId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return normalizeModuleQuizPayload(raw)
}

export async function generateModuleQuizQuestions(
  courseCode: string,
  itemId: string,
  body: { prompt: string; questionCount: number },
): Promise<{ questions: QuizQuestion[] }> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/quizzes/${encodeURIComponent(itemId)}/generate-questions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: body.prompt,
        questionCount: body.questionCount,
      }),
    },
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw as { questions: QuizQuestion[] }
}

export type AdaptiveQuizHistoryTurn = {
  prompt: string
  questionType: string
  choices: string[]
  choiceWeights: number[]
  selectedChoiceIndex: number | null
  /** Carried from the generated question when submitting an attempt. */
  points?: number
}

export type AdaptiveQuizGeneratedQuestion = {
  prompt: string
  questionType: string
  choices: string[]
  choiceWeights: number[]
  multipleAnswer: boolean
  answerWithImage: boolean
  required: boolean
  points: number
  estimatedMinutes: number
}

export type AdaptiveQuizNextResponse =
  | { finished: true; message?: string | null; questions?: AdaptiveQuizGeneratedQuestion[] }
  | { finished: false; questions: AdaptiveQuizGeneratedQuestion[] }

export async function postAdaptiveQuizNext(
  courseCode: string,
  itemId: string,
  body: { history: AdaptiveQuizHistoryTurn[]; attemptId?: string },
): Promise<AdaptiveQuizNextResponse> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/quizzes/${encodeURIComponent(itemId)}/adaptive-next`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        history: body.history,
        ...(body.attemptId ? { attemptId: body.attemptId } : {}),
      }),
    },
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw as AdaptiveQuizNextResponse
}

/** Pick a choice index for automated adaptive runs (highest model weight, tie-break first). */
export function autoPickAdaptiveChoiceIndex(q: AdaptiveQuizGeneratedQuestion): number | null {
  if (q.questionType !== 'multiple_choice' && q.questionType !== 'true_false') {
    return null
  }
  if (q.choices.length === 0) return null
  let best = 0
  for (let i = 1; i < q.choices.length; i++) {
    const w = q.choiceWeights[i] ?? 0
    const wb = q.choiceWeights[best] ?? 0
    if (w > wb) best = i
  }
  return best
}

/**
 * Walks an adaptive quiz to completion by submitting one answer per step, matching the
 * client prefetch behavior used in the student preview panel.
 */
export async function runAdaptiveQuizToCompletion(
  courseCode: string,
  itemId: string,
  maxQuestions: number,
  attemptId?: string,
): Promise<{ answeredCount: number; finished: boolean; message: string | null }> {
  const history: AdaptiveQuizHistoryTurn[] = []
  let pending: AdaptiveQuizGeneratedQuestion[] = []
  const cap = Math.min(30, Math.max(1, Math.floor(maxQuestions) || 1))

  while (history.length < cap) {
    const remainingSlots = cap - history.length
    const need = Math.min(2, remainingSlots)
    if (pending.length < need) {
      const res = await postAdaptiveQuizNext(courseCode, itemId, { history, attemptId })
      if (res.finished) {
        return {
          answeredCount: history.length,
          finished: true,
          message: res.message ?? null,
        }
      }
      const batch = res.questions
      if (!batch.length) {
        throw new Error('The server returned no questions.')
      }
      pending = [...pending, ...batch]
    }
    const q = pending[0]
    if (!q) break
    const selectedIdx = autoPickAdaptiveChoiceIndex(q)
    if ((q.questionType === 'multiple_choice' || q.questionType === 'true_false') && selectedIdx == null) {
      throw new Error('A question had no answer choices to submit.')
    }
    history.push({
      prompt: q.prompt,
      questionType: q.questionType,
      choices: q.choices,
      choiceWeights: q.choiceWeights,
      selectedChoiceIndex: selectedIdx,
      points: q.points,
    })
    pending = pending.slice(1)
  }

  return { answeredCount: history.length, finished: true, message: null }
}

export type QuizAttemptStartResponse = {
  attemptId: string
  attemptNumber: number
  startedAt: string
}

export async function postQuizStart(
  courseCode: string,
  itemId: string,
  body?: { quizAccessCode?: string | null },
): Promise<QuizAttemptStartResponse> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/quizzes/${encodeURIComponent(itemId)}/start`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quizAccessCode: body?.quizAccessCode ?? undefined,
      }),
    },
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw as QuizAttemptStartResponse
}

export type QuizQuestionResponseItem = {
  questionId: string
  selectedChoiceIndex?: number
  selectedChoiceIndices?: number[]
  textAnswer?: string | null
}

export type QuizSubmitResponse = {
  attemptId: string
  pointsEarned: number
  pointsPossible: number
  scorePercent: number
}

export async function postQuizSubmit(
  courseCode: string,
  itemId: string,
  body: {
    attemptId: string
    responses?: QuizQuestionResponseItem[]
    adaptiveHistory?: AdaptiveQuizHistoryTurn[]
  },
): Promise<QuizSubmitResponse> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/quizzes/${encodeURIComponent(itemId)}/submit`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw as QuizSubmitResponse
}

export type QuizResultsQuestionResult = {
  questionIndex: number
  questionId?: string | null
  questionType: string
  promptSnapshot?: string | null
  responseJson: unknown
  isCorrect?: boolean | null
  pointsAwarded?: number | null
  maxPoints: number
  correctChoiceIndex?: number | null
}

export type QuizResultsPayload = {
  attemptId: string
  attemptNumber: number
  startedAt: string
  submittedAt?: string | null
  status: string
  isAdaptive: boolean
  score?: {
    pointsEarned: number
    pointsPossible: number
    scorePercent: number
  } | null
  questions?: QuizResultsQuestionResult[] | null
}

export async function fetchQuizResults(
  courseCode: string,
  itemId: string,
  query?: { attemptId?: string; studentUserId?: string },
): Promise<QuizResultsPayload> {
  const q = new URLSearchParams()
  if (query?.attemptId) q.set('attemptId', query.attemptId)
  if (query?.studentUserId) q.set('studentUserId', query.studentUserId)
  const qs = q.toString()
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/quizzes/${encodeURIComponent(itemId)}/results${qs ? `?${qs}` : ''}`,
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw as QuizResultsPayload
}

export async function fetchModuleContentPage(
  courseCode: string,
  itemId: string,
): Promise<ModuleContentPagePayload> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/content-pages/${encodeURIComponent(itemId)}`,
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return normalizeModuleContentPagePayload(raw)
}

export async function patchModuleContentPage(
  courseCode: string,
  itemId: string,
  body: { markdown: string; dueAt?: string | null },
): Promise<ModuleContentPagePayload> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/content-pages/${encodeURIComponent(itemId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return normalizeModuleContentPagePayload(raw)
}

export type ContentPageMarkup = {
  id: string
  kind: 'highlight' | 'note'
  quoteText: string
  notebookPageId: string | null
  commentText: string | null
  createdAt: string
}

/** Where highlight/note markups are stored for a Markdown reader surface. */
export type ReaderMarkupTarget =
  | { variant: 'content_page'; itemId: string }
  | { variant: 'assignment'; itemId: string }
  | { variant: 'quiz'; itemId: string }
  | { variant: 'syllabus' }

function readerMarkupsListPath(courseCode: string, target: ReaderMarkupTarget): string {
  const cc = encodeURIComponent(courseCode)
  switch (target.variant) {
    case 'content_page':
      return `/api/v1/courses/${cc}/content-pages/${encodeURIComponent(target.itemId)}/markups`
    case 'assignment':
      return `/api/v1/courses/${cc}/assignments/${encodeURIComponent(target.itemId)}/markups`
    case 'quiz':
      return `/api/v1/courses/${cc}/quizzes/${encodeURIComponent(target.itemId)}/markups`
    case 'syllabus':
      return `/api/v1/courses/${cc}/syllabus/markups`
  }
}

export async function fetchReaderMarkups(
  courseCode: string,
  target: ReaderMarkupTarget,
): Promise<ContentPageMarkup[]> {
  const res = await authorizedFetch(readerMarkupsListPath(courseCode, target))
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  const body = raw as { markups?: ContentPageMarkup[] }
  return body.markups ?? []
}

export async function postReaderMarkup(
  courseCode: string,
  target: ReaderMarkupTarget,
  body: {
    kind: 'highlight' | 'note'
    quoteText: string
    notebookPageId?: string | null
    commentText?: string | null
  },
): Promise<ContentPageMarkup> {
  const res = await authorizedFetch(readerMarkupsListPath(courseCode, target), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw as ContentPageMarkup
}

export async function deleteReaderMarkup(
  courseCode: string,
  target: ReaderMarkupTarget,
  markupId: string,
): Promise<void> {
  const base = readerMarkupsListPath(courseCode, target)
  const url = `${base}/${encodeURIComponent(markupId)}`
  const res = await authorizedFetch(url, { method: 'DELETE' })
  if (!res.ok) {
    const raw = await parseJson(res)
    throw new Error(readApiErrorMessage(raw))
  }
}

export async function fetchContentPageMarkups(
  courseCode: string,
  itemId: string,
): Promise<ContentPageMarkup[]> {
  return fetchReaderMarkups(courseCode, { variant: 'content_page', itemId })
}

export async function postContentPageMarkup(
  courseCode: string,
  itemId: string,
  body: {
    kind: 'highlight' | 'note'
    quoteText: string
    notebookPageId?: string | null
    commentText?: string | null
  },
): Promise<ContentPageMarkup> {
  return postReaderMarkup(courseCode, { variant: 'content_page', itemId }, body)
}

export async function deleteContentPageMarkup(
  courseCode: string,
  itemId: string,
  markupId: string,
): Promise<void> {
  return deleteReaderMarkup(courseCode, { variant: 'content_page', itemId }, markupId)
}

export async function fetchModuleAssignment(
  courseCode: string,
  itemId: string,
): Promise<ModuleContentPagePayload> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/assignments/${encodeURIComponent(itemId)}`,
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return normalizeModuleContentPagePayload(raw)
}

export async function patchModuleAssignment(
  courseCode: string,
  itemId: string,
  body: {
    markdown: string
    dueAt?: string | null
    pointsWorth?: number | null
    availableFrom?: string | null
    availableUntil?: string | null
    assignmentAccessCode?: string | null
    submissionAllowText?: boolean
    submissionAllowFileUpload?: boolean
    submissionAllowUrl?: boolean
  },
): Promise<ModuleContentPagePayload> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/assignments/${encodeURIComponent(itemId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return normalizeModuleContentPagePayload(raw)
}

/** Matches server `AppRole` for course-scoped roles dropdown (course creator only). */
export type CourseScopedAppRole = {
  id: string
  name: string
  description: string
  scope: string
  createdAt: string
}

export type SyllabusSection = {
  id: string
  heading: string
  markdown: string
}

export type CourseSyllabusPayload = {
  sections: SyllabusSection[]
  updatedAt: string
  requireSyllabusAcceptance: boolean
  /** Present when the viewer must acknowledge before using the course (students). */
  syllabusAcceptancePending?: boolean
}

export type SyllabusAcceptanceStatus = {
  requireSyllabusAcceptance: boolean
  hasAcceptedSyllabus: boolean
}

export async function fetchCourseSyllabus(courseCode: string): Promise<CourseSyllabusPayload> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/syllabus`,
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw as CourseSyllabusPayload
}

export async function fetchSyllabusAcceptanceStatus(
  courseCode: string,
): Promise<SyllabusAcceptanceStatus> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/syllabus/acceptance-status`,
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw as SyllabusAcceptanceStatus
}

export async function postSyllabusAccept(courseCode: string): Promise<void> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/syllabus/accept`,
    { method: 'POST' },
  )
  if (!res.ok) {
    const raw = await parseJson(res)
    throw new Error(readApiErrorMessage(raw))
  }
}

export async function patchCourseSyllabus(
  courseCode: string,
  body: { sections: SyllabusSection[]; requireSyllabusAcceptance: boolean },
): Promise<CourseSyllabusPayload> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/syllabus`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw as CourseSyllabusPayload
}

export async function generateSyllabusSectionMarkdown(
  courseCode: string,
  body: {
    instructions: string
    sectionHeading?: string
    existingMarkdown?: string
  },
): Promise<{ markdown: string }> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/syllabus/generate-section`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instructions: body.instructions,
        sectionHeading: body.sectionHeading ?? '',
        existingMarkdown: body.existingMarkdown ?? '',
      }),
    },
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw as { markdown: string }
}

export async function fetchCourseGradingSettings(courseCode: string): Promise<CourseGradingSettings> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/grading`,
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return parseCourseGradingSettings(raw)
}

export async function putCourseGradingSettings(
  courseCode: string,
  body: {
    gradingScale: string
    assignmentGroups: { id?: string; name: string; sortOrder: number; weightPercent: number }[]
  },
): Promise<CourseGradingSettings> {
  const res = await authorizedFetch(`/api/v1/courses/${encodeURIComponent(courseCode)}/grading`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      gradingScale: body.gradingScale,
      assignmentGroups: body.assignmentGroups,
    }),
  })
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return parseCourseGradingSettings(raw)
}

export async function patchCourseStructureItemAssignmentGroup(
  courseCode: string,
  itemId: string,
  assignmentGroupId: string | null,
): Promise<CourseStructureItem> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/structure/items/${encodeURIComponent(itemId)}/assignment-group`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignmentGroupId }),
    },
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw as CourseStructureItem
}

export async function fetchCourseScopedRoles(courseCode: string): Promise<CourseScopedAppRole[]> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/course-scoped-roles`,
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  const data = raw as { roles?: CourseScopedAppRole[] }
  return data.roles ?? []
}

/** Server: `user.user_audit` via POST `/course-context` (benign path for LMS state). */
export type CourseContextKind = 'course_visit' | 'content_open' | 'content_leave'

export async function postCourseContext(
  courseCode: string,
  body: { kind: CourseContextKind; structureItemId?: string },
  options?: { keepalive?: boolean },
): Promise<void> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/course-context`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: body.kind,
        ...(body.structureItemId != null ? { structureItemId: body.structureItemId } : {}),
      }),
      keepalive: options?.keepalive ?? false,
    },
  )
  if (!res.ok) {
    const raw = await res.json().catch(() => ({}))
    throw new Error(readApiErrorMessage(raw))
  }
}

export type CourseBundleImportMode = 'erase' | 'mergeAdd' | 'overwrite'

/** Full course export from `GET /api/v1/courses/:courseCode/export`. */
export type CourseExportBundle = Record<string, unknown>

export async function fetchCourseExport(courseCode: string): Promise<CourseExportBundle> {
  const res = await authorizedFetch(`/api/v1/courses/${encodeURIComponent(courseCode)}/export`)
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw as CourseExportBundle
}

export async function postCourseImport(
  courseCode: string,
  body: { mode: CourseBundleImportMode; export: CourseExportBundle },
): Promise<void> {
  const res = await authorizedFetch(`/api/v1/courses/${encodeURIComponent(courseCode)}/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const raw = await res.json().catch(() => ({}))
    throw new Error(readApiErrorMessage(raw))
  }
}

export type PostCourseImportCanvasBody = {
  mode: CourseBundleImportMode
  canvasBaseUrl: string
  canvasCourseId: string
  accessToken: string
}

function courseCanvasImportWebSocketUrl(courseCode: string): string | null {
  if (!getAccessToken()) return null
  const base = import.meta.env.VITE_API_URL ?? 'http://localhost:8080'
  const u = new URL(base)
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${u.origin}/api/v1/courses/${encodeURIComponent(courseCode)}/import/canvas/ws`
}

/**
 * Pulls course data from the Canvas REST API (via our server) and applies it like a JSON import.
 * Uses a WebSocket for progress messages (`onProgress`); the Canvas token is sent once and is not stored.
 */
export async function postCourseImportCanvas(
  courseCode: string,
  body: PostCourseImportCanvasBody,
  onProgress?: (message: string) => void,
): Promise<void> {
  const url = courseCanvasImportWebSocketUrl(courseCode)
  const authToken = getAccessToken()
  if (!url) {
    throw new Error('Sign in to import from Canvas.')
  }
  if (!authToken) {
    throw new Error('Sign in to import from Canvas.')
  }

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(url)
    let settled = false

    const fail = (msg: string) => {
      if (settled) return
      settled = true
      reject(new Error(msg))
    }

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          authToken,
          mode: body.mode,
          canvasBaseUrl: body.canvasBaseUrl,
          canvasCourseId: body.canvasCourseId,
          accessToken: body.accessToken,
        }),
      )
    }

    ws.onmessage = (ev) => {
      let raw: unknown
      try {
        raw = JSON.parse(String(ev.data))
      } catch {
        fail('Unexpected message from server.')
        ws.close()
        return
      }
      const o = raw as { type?: string; message?: string }
      if (o.type === 'progress' && typeof o.message === 'string') {
        onProgress?.(o.message)
        return
      }
      if (o.type === 'complete') {
        if (!settled) {
          settled = true
          ws.close()
          resolve()
        }
        return
      }
      if (o.type === 'error') {
        fail(typeof o.message === 'string' ? o.message : 'Canvas import failed.')
        ws.close()
      }
    }

    ws.onerror = () => {
      fail('Connection error during Canvas import.')
    }

    ws.onclose = () => {
      if (!settled) {
        fail('Connection closed before import finished.')
      }
    }
  })
}
