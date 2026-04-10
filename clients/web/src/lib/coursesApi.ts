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
  /** `fixed` (calendar) or `relative` (per-student enrollment). */
  scheduleMode?: string
  /** ISO 8601 duration from enrollment (e.g. P90D) when relative. */
  relativeEndAfter?: string | null
  relativeHiddenAfter?: string | null
  relativeScheduleAnchorAt?: string | null
  published: boolean
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

/** `course:<courseCode>:enrollments:update` — change roster rows for that course (e.g. remove a role). */
export function courseEnrollmentsUpdatePermission(courseCode: string): string {
  return `course:${courseCode}:enrollments:update`
}

export type CourseStructureItem = {
  id: string
  sortOrder: number
  kind: 'module' | 'heading' | 'content_page' | 'assignment' | 'quiz'
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
  | { finished: true; message?: string | null }
  | { finished: false; question: AdaptiveQuizGeneratedQuestion }

export async function postAdaptiveQuizNext(
  courseCode: string,
  itemId: string,
  body: { history: AdaptiveQuizHistoryTurn[] },
): Promise<AdaptiveQuizNextResponse> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/quizzes/${encodeURIComponent(itemId)}/adaptive-next`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ history: body.history }),
    },
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw as AdaptiveQuizNextResponse
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
