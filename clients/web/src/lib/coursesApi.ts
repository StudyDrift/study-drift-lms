import { authorizedFetch } from './api'
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
  published: boolean
  markdownThemePreset: string
  markdownThemeCustom: MarkdownThemeCustom | null
  /** Display grading scale id (matches server `GRADING_SCALES`). */
  gradingScale: string
  createdAt: string
  updatedAt: string
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

export async function fetchCourse(courseCode: string): Promise<Course> {
  const res = await authorizedFetch(`/api/v1/courses/${encodeURIComponent(courseCode)}`)
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

/** `course:<courseCode>:gradebook:view` — course gradebook access for that course. */
export function courseGradebookViewPermission(courseCode: string): string {
  return `course:${courseCode}:gradebook:view`
}

export type CourseStructureItem = {
  id: string
  sortOrder: number
  kind: 'module' | 'heading' | 'content_page' | 'assignment' | 'quiz'
  title: string
  /** Set when this row is nested under a module. */
  parentId: string | null
  /** Module rows: when false, students do not see this module or its items. */
  published: boolean
  /** Module rows: optional UTC instant — students only see the module on or after this time. */
  visibleFrom: string | null
  /** Content pages: optional due time for calendar / assignments. */
  dueAt: string | null
  /** Which assignment group this gradable item counts toward (course grading settings). */
  assignmentGroupId: string | null
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

export async function courseStructureAiAssist(
  courseCode: string,
  body: { message: string },
): Promise<{ items: CourseStructureItem[]; assistantMessage: string | null }> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/structure/ai-assist`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw as { items: CourseStructureItem[]; assistantMessage: string | null }
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
  updatedAt: string
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

export type ModuleQuizPayload = {
  itemId: string
  title: string
  markdown: string
  dueAt: string | null
  questions: QuizQuestion[]
  updatedAt: string
}

export async function fetchModuleQuiz(courseCode: string, itemId: string): Promise<ModuleQuizPayload> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/quizzes/${encodeURIComponent(itemId)}`,
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw as ModuleQuizPayload
}

export async function patchModuleQuiz(
  courseCode: string,
  itemId: string,
  body: { markdown?: string; dueAt?: string | null; questions?: QuizQuestion[] },
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
  return raw as ModuleQuizPayload
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
  return raw as ModuleContentPagePayload
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
  return raw as ModuleContentPagePayload
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
  return raw as ModuleContentPagePayload
}

export async function patchModuleAssignment(
  courseCode: string,
  itemId: string,
  body: { markdown: string; dueAt?: string | null },
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
  return raw as ModuleContentPagePayload
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
}

export async function fetchCourseSyllabus(courseCode: string): Promise<CourseSyllabusPayload> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/syllabus`,
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw as CourseSyllabusPayload
}

export async function patchCourseSyllabus(
  courseCode: string,
  body: { sections: SyllabusSection[] },
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

export async function fetchCourseGradingSettings(courseCode: string): Promise<CourseGradingSettings> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/grading`,
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw as CourseGradingSettings
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
  return raw as CourseGradingSettings
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
