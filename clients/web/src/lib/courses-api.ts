import { apiUrl, authorizedFetch } from './api'
import { getAccessToken } from './auth'
import { readApiErrorMessage } from './errors'
import {
  accommodationSummaryPayloadSchema,
  accommodationUsersSearchResponseSchema,
  adaptiveQuizNextResponseSchema,
  bankQuestionDetailSchema,
  bankQuestionRowSchema,
  contentPageMarkupSchema,
  courseExportBundleSchema,
  courseFileUploadResponseSchema,
  courseGradingSettingsResultSchema,
  courseOutcomeLinkSchema,
  courseOutcomeSchema,
  courseOutcomeSubOutcomeSchema,
  courseOutcomesListResponseSchema,
  adaptivePathPreviewResponseSchema,
  courseSchema,
  courseScopedRolesResponseSchema,
  courseStructureItemSchema,
  courseStructureItemsResponseSchema,
  courseStandardsCoverageResponseSchema,
  courseSyllabusPayloadSchema,
  courseGradebookGridResponseSchema,
  courseGradingSchemeEnvelopeSchema,
  courseMyGradesRawSchema,
  enrollmentGroupsTreeResponseSchema,
  enrollmentNextResponseSchema,
  generateQuizQuestionsResponseSchema,
  generatedSyllabusSectionMarkdownSchema,
  idResponseSchema,
  learnerRecommendationsResponseSchema,
  misconceptionReportResponseSchema,
  misconceptionRowSchema,
  importMisconceptionSeedLibraryResponseSchema,
  parseApiResponse,
  pathConceptsResponseSchema,
  quizAdvanceResponseSchema,
  quizAttemptStartResponseSchema,
  quizHintRevealResponseSchema,
  quizWorkedExampleResponseSchema,
  quizAttemptsListPayloadSchema,
  quizCodeRunResponseSchema,
  quizCurrentQuestionPayloadSchema,
  quizFocusLossEventsResponseSchema,
  quizResultsPayloadSchema,
  quizSubmitResponseSchema,
  readerMarkupsListResponseSchema,
  reviewQueueResponseSchema,
  reviewStatsResponseSchema,
  restoreVersionResponseSchema,
  structurePathRuleSchema,
  structurePathRulesResponseSchema,
  studentAccommodationRecordSchema,
  studentAccommodationRecordsListSchema,
  syllabusAcceptanceStatusSchema,
  versionsListResponseSchema,
} from './courses-api-schemas'

import type { CourseStandardsCoveragePayload, StandardCoverageItem } from './courses-api-schemas'

import type { MarkdownThemeCustom } from './markdown-theme'

export type { StandardCoverageItem }

export type LateSubmissionPolicy = 'allow' | 'penalty' | 'block'

/** Mirrors server `models::course::CoursePublic` (API JSON for a course). */
export type CoursePublic = {
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
  /** Course notebook page in the LMS (default true when omitted by older servers). */
  notebookEnabled?: boolean
  /** Course discussion feed (default true when omitted). */
  feedEnabled?: boolean
  /** Course due-date calendar page (default true when omitted). */
  calendarEnabled?: boolean
  /** Normalized question bank + server-side pool sampling (default false when omitted). */
  questionBankEnabled?: boolean
  /** When true, instructors can configure quiz lockdown / kiosk delivery (plan 2.10). */
  lockdownModeEnabled?: boolean
  /** K-12 standards coverage UI and APIs (plan 1.3). */
  standardsAlignmentEnabled?: boolean
  /** Adaptive path rules (plan 1.4); requires platform env on server. */
  adaptivePathsEnabled?: boolean
  /** Spaced repetition review queue (plan 1.5); requires `SRS_PRACTICE_ENABLED` on server. */
  srsEnabled?: boolean
  /** Placement diagnostic (plan 1.7); requires `DIAGNOSTIC_ASSESSMENTS_ENABLED` on server. */
  diagnosticAssessmentsEnabled?: boolean
  /** Progressive hints + worked examples (plan 1.9). */
  hintScaffoldingEnabled?: boolean
  /** Misconception tagging + remediation in quiz results (plan 1.10). */
  misconceptionDetectionEnabled?: boolean
  /** `traditional` or `competency_based` (server default when omitted: traditional). */
  courseType?: string
  createdAt: string
  updatedAt: string
  /** Present on single-course GET: raw enrollment roles for the viewer (`teacher`, `student`, …). */
  viewerEnrollmentRoles?: string[]
  /** Student enrollment row id for adaptive “next” navigation when the viewer is enrolled as a student. */
  viewerStudentEnrollmentId?: string
  /** Server `ANNOTATION_ENABLED` — inline submission annotation / SpeedGrader surfaces. */
  annotationsEnabled?: boolean
  /** Server `FEEDBACK_MEDIA_ENABLED` — instructor A/V feedback on submissions (plan 3.2). */
  feedbackMediaEnabled?: boolean
}

export type StructurePathRule = {
  id: string
  structureItemId: string
  ruleType: string
  conceptIds: string[]
  threshold: number
  targetItemId?: string | null
  priority: number
  createdAt: string
}

export type PathConceptOption = { id: string; name: string; slug: string }

export type EnrollmentNextPayload = {
  item: CourseStructureItem
  skipReason?: string
  skipReasonKey?: string
  fallback?: boolean
}

/** LMS route for a learner-facing structure item. */
export function learnerCourseItemHref(courseCode: string, item: { kind: string; id: string }): string {
  const cc = encodeURIComponent(courseCode)
  const id = encodeURIComponent(item.id)
  switch (item.kind) {
    case 'content_page':
      return `/courses/${cc}/modules/content/${id}`
    case 'assignment':
      return `/courses/${cc}/modules/assignment/${id}`
    case 'quiz':
      return `/courses/${cc}/modules/quiz/${id}`
    case 'external_link':
      return `/courses/${cc}/modules/external-link/${id}`
    case 'lti_link':
      return `/courses/${cc}/modules/lti/${id}`
    default:
      return `/courses/${cc}/modules`
  }
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

/** Plan 3.6 — course scheme `type` / assignment `gradingType` (matches server). */
export const GRADING_SCHEME_DISPLAY_TYPES: { id: string; label: string }[] = [
  { id: 'points', label: 'Points (raw)' },
  { id: 'percentage', label: 'Percentage' },
  { id: 'letter', label: 'Letter grades' },
  { id: 'gpa', label: 'GPA scale' },
  { id: 'pass_fail', label: 'Pass / Fail' },
  { id: 'complete_incomplete', label: 'Complete / Incomplete' },
]

export const DEFAULT_LETTER_GRADE_SCALE_JSON: unknown = [
  { label: 'A', min_pct: 90, gpa: 4 },
  { label: 'B', min_pct: 80, gpa: 3 },
  { label: 'C', min_pct: 70, gpa: 2 },
  { label: 'D', min_pct: 60, gpa: 1 },
  { label: 'F', min_pct: 0, gpa: 0 },
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
  const built = buildCourseGradingSettings(raw)
  return courseGradingSettingsResultSchema.parse(built)
}

function buildCourseGradingSettings(raw: unknown): CourseGradingSettings {
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

export async function fetchCourse(courseCode: string): Promise<CoursePublic> {
  const res = await authorizedFetch(`/api/v1/courses/${encodeURIComponent(courseCode)}`)
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return parseApiResponse('fetchCourse', courseSchema, raw)
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
): Promise<CoursePublic> {
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
  return parseApiResponse('patchCourseArchived', courseSchema, raw)
}

/** Permanently removes module content, syllabus, files, and related data; course shell remains. */
export async function postFactoryResetCourse(courseCode: string): Promise<CoursePublic> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/factory-reset`,
    { method: 'POST' },
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return parseApiResponse('postFactoryResetCourse', courseSchema, raw)
}

export async function patchCourseMarkdownTheme(
  courseCode: string,
  body: { preset: string; custom?: MarkdownThemeCustom | null },
): Promise<CoursePublic> {
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
  return parseApiResponse('patchCourseMarkdownTheme', courseSchema, raw)
}

export type BankQuestionRow = {
  id: string
  courseId: string
  questionType: string
  stem: string
  status: string
  points: number
  shared: boolean
  source: string
  createdAt: string
  updatedAt: string
  versionNumber: number
  isPublished: boolean
  srsEligible?: boolean
}

export type BankQuestionDetail = BankQuestionRow & {
  options?: unknown
  correctAnswer?: unknown
  explanation?: string | null
  metadata?: unknown
  irtA?: number | null
  irtB?: number | null
  irtStatus?: string
  createdBy?: string | null
  /** When false, keep authored option order even if the quiz has shuffle-answers enabled. */
  shuffleChoicesOverride?: boolean | null
  optionMisconceptionTags?: { optionId: string; misconceptionId: string }[]
}

export type CreateBankQuestionBody = {
  questionType: string
  stem: string
  options?: unknown
  correctAnswer?: unknown
  explanation?: string
  points?: number
  status?: 'draft' | 'active' | 'retired'
  shared?: boolean
  metadata?: unknown
  shuffleChoicesOverride?: boolean
  srsEligible?: boolean
}

export type UpdateBankQuestionBody = {
  questionType?: string
  stem?: string
  options?: unknown | null
  correctAnswer?: unknown | null
  explanation?: string | null
  points?: number
  status?: 'draft' | 'active' | 'retired'
  shared?: boolean
  metadata?: unknown
  changeNote?: string
  /** Omit to leave unchanged; `null` clears override (inherit quiz setting). */
  shuffleChoicesOverride?: boolean | null
  srsEligible?: boolean
}

export type ReviewQueueItem = {
  stateId: string
  questionId: string
  courseId: string
  courseCode: string
  courseTitle: string
  nextReviewAt: string
  stem: string
  questionType: string
  options?: unknown
  correctAnswer?: unknown
  explanation?: string | null
}

export type ReviewQueuePayload = {
  items: ReviewQueueItem[]
  totalDue: number
}

export type ReviewStatsPayload = {
  streak: number
  dueToday: number
  dueWeek: number
  retentionEstimate: number
}

export type RecommendationItem = {
  itemId: string
  itemType: string
  title: string
  surface: string
  reason: string
  score: number
}

export type LearnerRecommendationsResponse = {
  recommendations: RecommendationItem[]
  degraded?: boolean
}

export type BankQuestionVersionSummary = {
  versionNumber: number
  changeNote?: string | null
  changeSummary?: unknown
  createdBy?: string | null
  createdAt: string
}

export async function fetchCourseQuestions(
  courseCode: string,
  opts?: { q?: string; type?: string; conceptId?: string; status?: string },
): Promise<BankQuestionRow[]> {
  const params = new URLSearchParams()
  if (opts?.q) params.set('q', opts.q)
  if (opts?.type) params.set('type', opts.type)
  if (opts?.conceptId) params.set('conceptId', opts.conceptId)
  if (opts?.status) params.set('status', opts.status)
  const qs = params.toString()
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/questions${qs ? `?${qs}` : ''}`,
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  if (!Array.isArray(raw)) return []
  return raw.map((row, i) => parseApiResponse(`fetchCourseQuestions[${i}]`, bankQuestionRowSchema, row))
}

export async function fetchCourseQuestion(
  courseCode: string,
  questionId: string,
): Promise<BankQuestionDetail> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/questions/${encodeURIComponent(questionId)}`,
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return parseApiResponse('fetchCourseQuestion', bankQuestionDetailSchema, raw)
}

export async function createCourseQuestion(
  courseCode: string,
  body: CreateBankQuestionBody,
): Promise<BankQuestionDetail> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/questions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return parseApiResponse('createCourseQuestion', bankQuestionDetailSchema, raw)
}

export async function updateCourseQuestion(
  courseCode: string,
  questionId: string,
  body: UpdateBankQuestionBody,
): Promise<BankQuestionDetail> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/questions/${encodeURIComponent(questionId)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return parseApiResponse('updateCourseQuestion', bankQuestionDetailSchema, raw)
}

export async function fetchCourseQuestionVersions(
  courseCode: string,
  questionId: string,
): Promise<BankQuestionVersionSummary[]> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/questions/${encodeURIComponent(questionId)}/versions`,
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  const body = parseApiResponse('fetchCourseQuestionVersions', versionsListResponseSchema, raw)
  return body.versions ?? []
}

export async function restoreCourseQuestionVersion(
  courseCode: string,
  questionId: string,
  versionNumber: number,
  changeNote?: string,
): Promise<number> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/questions/${encodeURIComponent(questionId)}/versions/${encodeURIComponent(String(versionNumber))}/restore`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changeNote ? { changeNote } : {}),
    },
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  const body = parseApiResponse('restoreCourseQuestionVersion', restoreVersionResponseSchema, raw)
  return typeof body.newVersionNumber === 'number' ? body.newVersionNumber : versionNumber
}

export async function patchCourseFeatures(
  courseCode: string,
  body: {
    notebookEnabled: boolean
    feedEnabled: boolean
    calendarEnabled: boolean
    questionBankEnabled: boolean
    lockdownModeEnabled?: boolean
    standardsAlignmentEnabled: boolean
    adaptivePathsEnabled?: boolean
    srsEnabled?: boolean
    diagnosticAssessmentsEnabled?: boolean
    hintScaffoldingEnabled?: boolean
    misconceptionDetectionEnabled?: boolean
  },
): Promise<CoursePublic> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/features`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notebookEnabled: body.notebookEnabled,
        feedEnabled: body.feedEnabled,
        calendarEnabled: body.calendarEnabled,
        questionBankEnabled: body.questionBankEnabled,
        lockdownModeEnabled: body.lockdownModeEnabled ?? false,
        standardsAlignmentEnabled: body.standardsAlignmentEnabled,
        adaptivePathsEnabled: body.adaptivePathsEnabled,
        srsEnabled: body.srsEnabled,
        diagnosticAssessmentsEnabled: body.diagnosticAssessmentsEnabled,
        hintScaffoldingEnabled: body.hintScaffoldingEnabled,
        misconceptionDetectionEnabled: body.misconceptionDetectionEnabled,
      }),
    },
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return parseApiResponse('patchCourseFeatures', courseSchema, raw)
}

export type EnrollmentDiagnosticGate = {
  status: 'off' | 'not_configured' | 'pending' | 'in_progress' | 'completed' | 'bypassed'
  diagnosticId?: string
  attempt?: {
    id: string
    startedAt: string
    completedAt?: string | null
    bypassed: boolean
    placementSummary?: unknown
  }
}

export async function fetchEnrollmentDiagnostic(enrollmentId: string): Promise<EnrollmentDiagnosticGate> {
  const res = await authorizedFetch(
    `/api/v1/enrollments/${encodeURIComponent(enrollmentId)}/diagnostic`,
  )
  const raw: unknown = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw as EnrollmentDiagnosticGate
}

export async function postDiagnosticStart(
  enrollmentId: string,
): Promise<{ attemptId: string; firstQuestion: AdaptiveQuizGeneratedQuestion }> {
  const res = await authorizedFetch(
    `/api/v1/enrollments/${encodeURIComponent(enrollmentId)}/diagnostic/start`,
    { method: 'POST' },
  )
  const raw: unknown = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw as { attemptId: string; firstQuestion: AdaptiveQuizGeneratedQuestion }
}

export async function postDiagnosticRespond(
  attemptId: string,
  body: { questionId: string; choiceIndex: number; responseMs?: number },
): Promise<{
  completed: boolean
  nextQuestion?: AdaptiveQuizGeneratedQuestion | null
  summary?: {
    concepts: {
      conceptId: string
      name: string
      theta: number
      mastery: number
      proficiencyKey: string
      proficiencyLabel: string
    }[]
    placementItemId: string
    placementTitle: string
  }
}> {
  const res = await authorizedFetch(
    `/api/v1/diagnostic-attempts/${encodeURIComponent(attemptId)}/respond`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        questionId: body.questionId,
        choiceIndex: body.choiceIndex,
        responseMs: body.responseMs,
      }),
    },
  )
  const raw: unknown = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw as {
    completed: boolean
    nextQuestion?: AdaptiveQuizGeneratedQuestion | null
    summary?: {
      concepts: {
        conceptId: string
        name: string
        theta: number
        mastery: number
        proficiencyKey: string
        proficiencyLabel: string
      }[]
      placementItemId: string
      placementTitle: string
    }
  }
}

export async function postDiagnosticBypass(enrollmentId: string): Promise<void> {
  const res = await authorizedFetch(
    `/api/v1/enrollments/${encodeURIComponent(enrollmentId)}/diagnostic/bypass`,
    { method: 'POST' },
  )
  if (!res.ok) {
    const raw: unknown = await res.json().catch(() => ({}))
    throw new Error(readApiErrorMessage(raw))
  }
}

export async function fetchLearnerReviewQueue(
  userId: string,
  opts?: { limit?: number; offset?: number },
): Promise<ReviewQueuePayload> {
  const params = new URLSearchParams()
  if (opts?.limit != null) params.set('limit', String(opts.limit))
  if (opts?.offset != null) params.set('offset', String(opts.offset))
  const qs = params.toString()
  const res = await authorizedFetch(
    `/api/v1/learners/${encodeURIComponent(userId)}/review-queue${qs ? `?${qs}` : ''}`,
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return parseApiResponse('fetchLearnerReviewQueue', reviewQueueResponseSchema, raw)
}

export async function fetchLearnerReviewStats(userId: string): Promise<ReviewStatsPayload> {
  const res = await authorizedFetch(
    `/api/v1/learners/${encodeURIComponent(userId)}/review-stats`,
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return parseApiResponse('fetchLearnerReviewStats', reviewStatsResponseSchema, raw)
}

export async function postLearnerSrsReview(
  userId: string,
  body: { questionId: string; grade: 'again' | 'hard' | 'good' | 'easy'; responseMs?: number },
): Promise<{ nextReviewAt: string; intervalDays: number }> {
  const res = await authorizedFetch(`/api/v1/learners/${encodeURIComponent(userId)}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw as { nextReviewAt: string; intervalDays: number }
}

export async function fetchLearnerRecommendations(
  userId: string,
  courseId: string,
  surface: 'continue' | 'strengthen' | 'challenge' | 'review',
  opts?: { limit?: number },
): Promise<LearnerRecommendationsResponse> {
  const params = new URLSearchParams()
  params.set('courseId', courseId)
  params.set('surface', surface)
  if (opts?.limit != null) params.set('limit', String(opts.limit))
  const res = await authorizedFetch(
    `/api/v1/learners/${encodeURIComponent(userId)}/recommendations?${params.toString()}`,
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return parseApiResponse('fetchLearnerRecommendations', learnerRecommendationsResponseSchema, raw)
}

export async function postRecommendationEvent(body: {
  courseId: string
  itemId?: string | null
  surface: string
  eventType: 'impression' | 'click' | 'dismiss'
  rank?: number | null
}): Promise<void> {
  const res = await authorizedFetch('/api/v1/recommendations/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const raw = await parseJson(res)
    throw new Error(readApiErrorMessage(raw))
  }
}

export async function fetchStructurePathRules(
  courseCode: string,
  structureItemId: string,
): Promise<StructurePathRule[]> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/structure/items/${encodeURIComponent(structureItemId)}/path-rules`,
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return parseApiResponse('fetchStructurePathRules', structurePathRulesResponseSchema, raw)
}

export async function createStructurePathRule(
  courseCode: string,
  structureItemId: string,
  body: {
    ruleType: string
    conceptIds: string[]
    threshold: number
    targetItemId?: string | null
    priority?: number
  },
): Promise<StructurePathRule> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/structure/items/${encodeURIComponent(structureItemId)}/path-rules`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ruleType: body.ruleType,
        conceptIds: body.conceptIds,
        threshold: body.threshold,
        targetItemId: body.targetItemId ?? null,
        priority: body.priority ?? 0,
      }),
    },
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return parseApiResponse('createStructurePathRule', structurePathRuleSchema, raw)
}

export async function deleteStructurePathRule(
  courseCode: string,
  structureItemId: string,
  ruleId: string,
): Promise<void> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/structure/items/${encodeURIComponent(structureItemId)}/path-rules/${encodeURIComponent(ruleId)}`,
    { method: 'DELETE' },
  )
  if (res.ok || res.status === 204) return
  const raw = await parseJson(res)
  throw new Error(readApiErrorMessage(raw))
}

export async function fetchCourseConceptsForPath(courseCode: string): Promise<PathConceptOption[]> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/concepts-for-path`,
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return parseApiResponse('fetchCourseConceptsForPath', pathConceptsResponseSchema, raw)
}

export async function fetchAdaptivePathPreview(
  courseCode: string,
  mastery: Record<string, number>,
): Promise<{ path: string[]; fallback: boolean }> {
  const qs = new URLSearchParams({
    mastery: JSON.stringify(mastery),
  })
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/adaptive-path?${qs.toString()}`,
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  const parsed = parseApiResponse('fetchAdaptivePathPreview', adaptivePathPreviewResponseSchema, raw)
  return { path: parsed.path, fallback: parsed.fallback ?? false }
}

export async function fetchEnrollmentNext(
  enrollmentId: string,
  params?: { fromItemId?: string },
): Promise<EnrollmentNextPayload> {
  const qs = new URLSearchParams()
  if (params?.fromItemId) qs.set('fromItemId', params.fromItemId)
  const q = qs.toString()
  const res = await authorizedFetch(
    `/api/v1/enrollments/${encodeURIComponent(enrollmentId)}/next${q ? `?${q}` : ''}`,
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return parseApiResponse('fetchEnrollmentNext', enrollmentNextResponseSchema, raw)
}

export async function fetchCourseStandardsCoverage(
  courseCode: string,
  params: { framework: string; grade?: string },
): Promise<CourseStandardsCoveragePayload> {
  const qs = new URLSearchParams({ framework: params.framework })
  if (params.grade) qs.set('grade', params.grade)
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/standards-coverage?${qs.toString()}`,
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return parseApiResponse('fetchCourseStandardsCoverage', courseStandardsCoverageResponseSchema, raw)
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
  return parseApiResponse('uploadCourseFile', courseFileUploadResponseSchema, raw)
}

export async function createCourse(body: {
  title: string
  description: string
  courseType?: 'traditional' | 'competency_based'
}): Promise<CoursePublic> {
  const res = await authorizedFetch('/api/v1/courses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return parseApiResponse('createCourse', courseSchema, raw)
}

/** `PUT /api/v1/courses/:courseCode` — general course fields (matches course settings save). */
export async function putCourse(
  courseCode: string,
  body: {
    title: string
    description: string
    published: boolean
    startsAt: string | null
    endsAt: string | null
    visibleFrom: string | null
    hiddenAt: string | null
    scheduleMode: 'fixed' | 'relative'
    relativeEndAfter: string | null
    relativeHiddenAfter: string | null
  },
): Promise<CoursePublic> {
  const res = await authorizedFetch(`/api/v1/courses/${encodeURIComponent(courseCode)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: body.title,
      description: body.description,
      published: body.published,
      startsAt: body.startsAt,
      endsAt: body.endsAt,
      visibleFrom: body.visibleFrom,
      hiddenAt: body.hiddenAt,
      scheduleMode: body.scheduleMode,
      relativeEndAfter: body.relativeEndAfter,
      relativeHiddenAfter: body.relativeHiddenAfter,
    }),
  })
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return parseApiResponse('putCourse', courseSchema, raw)
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
  return parseApiResponse('fetchEnrollmentGroupsTree', enrollmentGroupsTreeResponseSchema, raw)
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
  const parsed = parseApiResponse('postEnrollmentGroupSet', idResponseSchema, raw)
  return parsed.id
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
  const parsed = parseApiResponse('postEnrollmentGroupInSet', idResponseSchema, raw)
  return parsed.id
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
  // Teacher preview: show when the viewer has a learner enrollment, including dual student+staff.
  return roles.includes('student')
}

export type CourseStructureItem = {
  id: string
  sortOrder: number
  kind:
    | 'module'
    | 'heading'
    | 'content_page'
    | 'assignment'
    | 'quiz'
    | 'external_link'
    | 'survey'
    | 'lti_link'
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
  const body = parseApiResponse('fetchCourseStructure', courseStructureItemsResponseSchema, raw)
  return body.items
}

/** GET `/gradebook/grid` — enrolled students and gradable module items (assignments and quizzes). */
export type CourseGradebookGridStudent = {
  userId: string
  displayName: string
}

/** Assignment rubric: criteria with point-band levels (matches server `RubricDefinition`). */
export type RubricLevel = {
  label: string
  points: number
  /** Optional notes for this rating band on this criterion (stored in `rubric_json`). */
  description?: string | null
}

export type RubricCriterion = {
  id: string
  title: string
  description?: string | null
  levels: RubricLevel[]
}

export type RubricDefinition = {
  /** Optional heading above the criteria grid (e.g. section title). */
  title?: string | null
  criteria: RubricCriterion[]
}

export type CourseGradebookGridColumn = {
  id: string
  kind: string
  title: string
  maxPoints: number | null
  assignmentGroupId?: string | null
  rubric?: RubricDefinition | null
  assignmentGradingType?: string | null
  effectiveDisplayType?: string
}

export type GradingSchemeSummary = {
  type: string
  scaleJson: unknown
}

export type CourseGradebookGridResponse = {
  students: CourseGradebookGridStudent[]
  columns: CourseGradebookGridColumn[]
  /** Saved scores keyed by student user id, then module item id. */
  grades?: Record<string, Record<string, string>>
  /** Display strings per cell (letter, pass/fail, …). */
  displayGrades?: Record<string, Record<string, string>>
  /** Rubric criterion scores: student → item → criterion id → points. */
  rubricScores?: Record<string, Record<string, Record<string, string>>>
  gradingScheme?: GradingSchemeSummary | null
}

export async function fetchCourseGradebookGrid(courseCode: string): Promise<CourseGradebookGridResponse> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/gradebook/grid`,
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return parseApiResponse('fetchCourseGradebookGrid', courseGradebookGridResponseSchema, raw)
}

/** GET `/my-grades` — current user’s grades (enrolled as student only). */
export type CourseMyGradesResponse = {
  columns: CourseGradebookGridColumn[]
  grades: Record<string, string>
  displayGrades: Record<string, string>
  assignmentGroups: AssignmentGroup[]
  gradingScheme?: GradingSchemeSummary | null
}

export async function fetchCourseMyGrades(courseCode: string): Promise<CourseMyGradesResponse> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/my-grades`,
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  const body = parseApiResponse('fetchCourseMyGrades', courseMyGradesRawSchema, raw)
  const parsed = parseCourseGradingSettings({ assignmentGroups: body.assignmentGroups })
  return {
    columns: body.columns ?? [],
    grades: body.grades ?? {},
    displayGrades: body.displayGrades ?? {},
    assignmentGroups: parsed.assignmentGroups,
    gradingScheme: body.gradingScheme ?? null,
  }
}

/** PUT `/gradebook/grades` — bulk upsert/clear cells (`course:<code>:item:create`). */
export async function putCourseGradebookGrades(
  courseCode: string,
  body: {
    grades: Record<string, Record<string, string>>
    rubricScores?: Record<string, Record<string, Record<string, number>>>
  },
): Promise<void> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/gradebook/grades`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grades: body.grades,
        ...(body.rubricScores && Object.keys(body.rubricScores).length > 0
          ? { rubricScores: body.rubricScores }
          : {}),
      }),
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
  const body = parseApiResponse('fetchCourseArchivedStructure', courseStructureItemsResponseSchema, raw)
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
  const data = parseApiResponse('reorderCourseStructure', courseStructureItemsResponseSchema, raw)
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
  return parseApiResponse('CourseStructureItem', courseStructureItemSchema, raw)
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
  return parseApiResponse('CourseStructureItem', courseStructureItemSchema, raw)
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
  return parseApiResponse('CourseStructureItem', courseStructureItemSchema, raw)
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
  return parseApiResponse('CourseStructureItem', courseStructureItemSchema, raw)
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
  lateSubmissionPolicy: LateSubmissionPolicy
  latePenaltyPercent: number | null
  /** Assignment rubric when configured. */
  rubric: RubricDefinition | null
  /** Plan 3.3 — hide student identifiers from graders until revealed. */
  blindGrading: boolean
  identitiesRevealedAt: string | null
  /** Course creator only; true when reveal API is available. */
  viewerCanRevealIdentities: boolean
  /** Plan 3.4 — staff-only detail; learners always see false. */
  moderatedGrading: boolean
  moderationThresholdPct: number | null
  moderatorUserId: string | null
  provisionalGraderUserIds: string[] | null
  /** Plan 3.5 — disabled | plagiarism | ai | both */
  originalityDetection: OriginalityDetectionMode
  /** Plan 3.5 — learner visibility for scores */
  originalityStudentVisibility: OriginalityStudentVisibility
  /** Plan 3.6 — assignment display override (omit = inherit course scheme). */
  gradingType?: string | null
}

export type OriginalityDetectionMode = 'disabled' | 'plagiarism' | 'ai' | 'both'
export type OriginalityStudentVisibility = 'show' | 'hide' | 'show_after_grading'

export function parseRubricDefinition(raw: unknown): RubricDefinition | null {
  if (raw == null || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const titleRaw = o.title
  const title =
    typeof titleRaw === 'string' && titleRaw.trim() ? titleRaw.trim() : null
  const critRaw = o.criteria
  if (!Array.isArray(critRaw)) return null
  const criteria: RubricCriterion[] = []
  for (const c of critRaw) {
    if (!c || typeof c !== 'object') continue
    const cr = c as Record<string, unknown>
    const id = typeof cr.id === 'string' ? cr.id : null
    const title = typeof cr.title === 'string' ? cr.title.trim() : ''
    const levelsRaw = cr.levels
    if (!id || !title || !Array.isArray(levelsRaw)) continue
    const levels: RubricLevel[] = []
    for (const lv of levelsRaw) {
      if (!lv || typeof lv !== 'object') continue
      const l = lv as Record<string, unknown>
      const label = typeof l.label === 'string' ? l.label.trim() : ''
      const points = typeof l.points === 'number' && Number.isFinite(l.points) ? l.points : NaN
      if (!label || !Number.isFinite(points)) continue
      const levelDescRaw = l.description
      const levelDesc =
        typeof levelDescRaw === 'string' && levelDescRaw.trim() ? levelDescRaw.trim() : null
      levels.push({ label, points, description: levelDesc })
    }
    if (levels.length === 0) continue
    const description =
      typeof cr.description === 'string' && cr.description.trim() ? cr.description.trim() : null
    criteria.push({ id, title, description, levels })
  }
  return criteria.length > 0 ? { ...(title ? { title } : {}), criteria } : null
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
    lateSubmissionPolicy: (r.lateSubmissionPolicy as LateSubmissionPolicy) ?? 'allow',
    latePenaltyPercent: typeof r.latePenaltyPercent === 'number' ? r.latePenaltyPercent : null,
    rubric: parseRubricDefinition(r.rubric),
    blindGrading: Boolean(r.blindGrading),
    identitiesRevealedAt:
      typeof r.identitiesRevealedAt === 'string' ? r.identitiesRevealedAt : null,
    viewerCanRevealIdentities: Boolean(r.viewerCanRevealIdentities),
    moderatedGrading: Boolean(r.moderatedGrading),
    moderationThresholdPct:
      typeof r.moderationThresholdPct === 'number' ? r.moderationThresholdPct : null,
    moderatorUserId: typeof r.moderatorUserId === 'string' ? r.moderatorUserId : null,
    provisionalGraderUserIds: Array.isArray(r.provisionalGraderUserIds)
      ? (r.provisionalGraderUserIds as unknown[]).filter((x): x is string => typeof x === 'string')
      : null,
    originalityDetection: normalizeOriginalityDetection(r.originalityDetection),
    originalityStudentVisibility: normalizeOriginalityStudentVisibility(r.originalityStudentVisibility),
    gradingType:
      typeof r.gradingType === 'string' && r.gradingType.trim()
        ? r.gradingType.trim()
        : null,
  }
}

function normalizeOriginalityDetection(raw: unknown): OriginalityDetectionMode {
  const s = typeof raw === 'string' ? raw.trim() : ''
  if (s === 'plagiarism' || s === 'ai' || s === 'both') return s
  return 'disabled'
}

function normalizeOriginalityStudentVisibility(raw: unknown): OriginalityStudentVisibility {
  const s = typeof raw === 'string' ? raw.trim() : ''
  if (s === 'show' || s === 'show_after_grading') return s
  return 'hide'
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
  return parseApiResponse('CourseStructureItem', courseStructureItemSchema, raw)
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
  return parseApiResponse('CourseStructureItem', courseStructureItemSchema, raw)
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
  return parseApiResponse('CourseStructureItem', courseStructureItemSchema, raw)
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
  return parseApiResponse('CourseStructureItem', courseStructureItemSchema, raw)
}

export type LtiExternalToolSummary = { id: string; name: string }

export async function fetchCourseLtiExternalTools(courseCode: string): Promise<LtiExternalToolSummary[]> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/lti-external-tools`,
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  if (!Array.isArray(raw)) return []
  return raw.map((row) => {
    const r = row as Record<string, unknown>
    return { id: String(r.id ?? ''), name: String(r.name ?? '') }
  })
}

export async function createModuleLtiLink(
  courseCode: string,
  moduleId: string,
  body: {
    title: string
    externalToolId: string
    resourceLinkId?: string
    lineItemUrl?: string
  },
): Promise<CourseStructureItem> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/structure/modules/${encodeURIComponent(moduleId)}/lti-links`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: body.title,
        externalToolId: body.externalToolId,
        resourceLinkId: body.resourceLinkId ?? '',
        lineItemUrl: body.lineItemUrl,
      }),
    },
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return parseApiResponse('CourseStructureItem', courseStructureItemSchema, raw)
}

export type ModuleLtiLinkPayload = {
  itemId: string
  title: string
  externalToolId: string
  externalToolName: string
  resourceLinkId: string
  lineItemUrl: string | null
}

function normalizeModuleLtiLinkPayload(raw: unknown): ModuleLtiLinkPayload {
  const r = raw as Record<string, unknown>
  return {
    itemId: String(r.itemId ?? ''),
    title: String(r.title ?? ''),
    externalToolId: String(r.externalToolId ?? ''),
    externalToolName: String(r.externalToolName ?? ''),
    resourceLinkId: String(r.resourceLinkId ?? ''),
    lineItemUrl: r.lineItemUrl == null ? null : String(r.lineItemUrl),
  }
}

export async function fetchModuleLtiLink(
  courseCode: string,
  itemId: string,
): Promise<ModuleLtiLinkPayload> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/lti-links/${encodeURIComponent(itemId)}`,
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return normalizeModuleLtiLinkPayload(raw)
}

export async function postModuleLtiEmbedTicket(
  courseCode: string,
  itemId: string,
): Promise<{ ticket: string }> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/lti-links/${encodeURIComponent(itemId)}/embed-ticket`,
    { method: 'POST' },
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  const r = raw as Record<string, unknown>
  return { ticket: String(r.ticket ?? '') }
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
  questionType:
    | 'multiple_choice'
    | 'fill_in_blank'
    | 'essay'
    | 'true_false'
    | 'short_answer'
    | 'matching'
    | 'ordering'
    | 'hotspot'
    | 'numeric'
    | 'formula'
    | 'code'
    | 'file_upload'
    | 'audio_response'
    | 'video_response'
  choices: string[]
  /** Stable UUID strings per choice (authored order), when the bank normalized options JSON. */
  choiceIds?: string[]
  typeConfig?: Record<string, unknown>
  correctChoiceIndex: number | null
  multipleAnswer: boolean
  answerWithImage: boolean
  required: boolean
  points: number
  estimatedMinutes: number
}

export type GradeAttemptPolicy = 'highest' | 'latest' | 'first' | 'average'
export type ShowScoreTiming = 'immediate' | 'after_due' | 'manual'
export type ReviewVisibility = 'none' | 'score_only' | 'responses' | 'correct_answers' | 'full'
export type ReviewWhen = 'after_submit' | 'after_due' | 'always' | 'never'
export type AdaptiveDifficulty = 'introductory' | 'standard' | 'challenging'
export type AdaptiveStopRule = 'fixed_count' | 'mastery_estimate'
export type AdaptiveDeliveryMode = 'ai' | 'cat'

export type LockdownMode = 'standard' | 'one_at_a_time' | 'kiosk'

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
  /** Effective for learners; stored value for editors when course lockdown feature is on. */
  lockdownMode: LockdownMode
  /** Instructor-only; omitted for learners. */
  focusLossThreshold?: number | null
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
  /** When true, question order/pool is fixed server-side for the current attempt. */
  usesServerQuestionSampling?: boolean
  updatedAt: string
  isAdaptive: boolean
  /** Omitted for learners when the quiz is adaptive. */
  adaptiveSystemPrompt: string | null
  adaptiveSourceItemIds: string[] | null
  adaptiveQuestionCount: number
  adaptiveDeliveryMode: AdaptiveDeliveryMode
  /** Course grading category; null when unset. */
  assignmentGroupId: string | null
  /** Course feature: progressive hints + worked examples (plan 1.9). */
  hintScaffoldingEnabled?: boolean
  misconceptionDetectionEnabled?: boolean
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
    lockdownMode: (r.lockdownMode as LockdownMode) ?? 'standard',
    focusLossThreshold:
      typeof r.focusLossThreshold === 'number'
        ? r.focusLossThreshold
        : r.focusLossThreshold === null
          ? null
          : undefined,
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
    usesServerQuestionSampling: Boolean(r.usesServerQuestionSampling),
    updatedAt: String(r.updatedAt ?? ''),
    isAdaptive: Boolean(r.isAdaptive),
    adaptiveSystemPrompt: (r.adaptiveSystemPrompt as string | null | undefined) ?? null,
    adaptiveSourceItemIds: Array.isArray(r.adaptiveSourceItemIds)
      ? (r.adaptiveSourceItemIds as string[])
      : null,
    adaptiveQuestionCount: typeof r.adaptiveQuestionCount === 'number' ? r.adaptiveQuestionCount : 5,
    adaptiveDeliveryMode: r.adaptiveDeliveryMode === 'cat' ? 'cat' : 'ai',
    assignmentGroupId: typeof r.assignmentGroupId === 'string' ? r.assignmentGroupId : null,
    hintScaffoldingEnabled: Boolean(r.hintScaffoldingEnabled),
    misconceptionDetectionEnabled: Boolean(r.misconceptionDetectionEnabled),
  }
}

export async function fetchModuleQuiz(
  courseCode: string,
  itemId: string,
  opts?: { attemptId?: string },
): Promise<ModuleQuizPayload> {
  const params = new URLSearchParams()
  if (opts?.attemptId) params.set('attemptId', opts.attemptId)
  const qs = params.toString()
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/quizzes/${encodeURIComponent(itemId)}${qs ? `?${qs}` : ''}`,
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
    lockdownMode?: LockdownMode
    focusLossThreshold?: number | null
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
    adaptiveDeliveryMode?: AdaptiveDeliveryMode
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
  return parseApiResponse('generateModuleQuizQuestions', generateQuizQuestionsResponseSchema, raw)
}

export type AdaptiveQuizHistoryTurn = {
  questionId?: string
  prompt: string
  questionType: string
  choices: string[]
  choiceWeights: number[]
  selectedChoiceIndex: number | null
  /** Carried from the generated question when submitting an attempt. */
  points?: number
}

export type AdaptiveQuizGeneratedQuestion = {
  questionId?: string
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
  return parseApiResponse('postAdaptiveQuizNext', adaptiveQuizNextResponseSchema, raw)
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
      ...(q.questionId ? { questionId: q.questionId } : {}),
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
  lockdownMode: LockdownMode
  hintsDisabled: boolean
  backNavigationAllowed: boolean
  currentQuestionIndex: number
  deadlineAt?: string | null
  reducedDistractionMode?: boolean
  /** Same as quiz grade policy (which score counts). */
  retakePolicy: string
  /** Omitted when unlimited attempts. */
  maxAttempts?: number | null
  /** Omitted when unlimited; tries left after this one. */
  remainingAttempts?: number | null
  hintScaffoldingEnabled?: boolean
  misconceptionDetectionEnabled?: boolean
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
  const o = raw as Record<string, unknown>
  const retakePolicy =
    typeof o.retakePolicy === 'string'
      ? o.retakePolicy
      : typeof o.gradeAttemptPolicy === 'string'
        ? o.gradeAttemptPolicy
        : 'latest'
  return quizAttemptStartResponseSchema.parse({
    attemptId: String(o.attemptId ?? ''),
    attemptNumber: typeof o.attemptNumber === 'number' ? o.attemptNumber : 1,
    startedAt: String(o.startedAt ?? ''),
    lockdownMode: (o.lockdownMode as LockdownMode) ?? 'standard',
    hintsDisabled: Boolean(o.hintsDisabled),
    backNavigationAllowed: o.backNavigationAllowed !== false,
    currentQuestionIndex: typeof o.currentQuestionIndex === 'number' ? o.currentQuestionIndex : 0,
    deadlineAt: typeof o.deadlineAt === 'string' ? o.deadlineAt : null,
    reducedDistractionMode: Boolean(o.reducedDistractionMode),
    retakePolicy,
    maxAttempts: typeof o.maxAttempts === 'number' ? o.maxAttempts : (o.maxAttempts === null ? null : undefined),
    remainingAttempts:
      typeof o.remainingAttempts === 'number'
        ? o.remainingAttempts
        : o.remainingAttempts === null
          ? null
          : undefined,
    hintScaffoldingEnabled: Boolean(o.hintScaffoldingEnabled),
    misconceptionDetectionEnabled: Boolean(o.misconceptionDetectionEnabled),
  })
}

export type QuizAttemptSummaryApi = {
  id: string
  attemptNumber: number
  submittedAt: string
  scorePercent?: number | null
  pointsEarned: number
  pointsPossible: number
}

export type QuizAttemptsListPayload = {
  attempts: QuizAttemptSummaryApi[]
  policyScorePercent?: number | null
  retakePolicy: string
}

export async function fetchQuizAttemptsList(
  courseCode: string,
  itemId: string,
  opts?: { userId?: string },
): Promise<QuizAttemptsListPayload> {
  const qs =
    opts?.userId != null && opts.userId !== ''
      ? `?userId=${encodeURIComponent(opts.userId)}`
      : ''
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/quizzes/${encodeURIComponent(itemId)}/attempts${qs}`,
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return parseApiResponse('fetchQuizAttemptsList', quizAttemptsListPayloadSchema, raw)
}

export async function putEnrollmentQuizOverride(
  courseCode: string,
  enrollmentId: string,
  body: { quizId: string; extraAttempts: number; timeMultiplier?: number | null },
): Promise<void> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/enrollments/${encodeURIComponent(enrollmentId)}/quiz-overrides`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quizId: body.quizId,
        extraAttempts: body.extraAttempts,
        timeMultiplier: body.timeMultiplier ?? undefined,
      }),
    },
  )
  if (!res.ok) {
    const raw = await parseJson(res)
    throw new Error(readApiErrorMessage(raw))
  }
}

export async function deleteEnrollmentQuizOverride(
  courseCode: string,
  enrollmentId: string,
  quizItemId: string,
): Promise<void> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/enrollments/${encodeURIComponent(enrollmentId)}/quiz-overrides/${encodeURIComponent(quizItemId)}`,
    { method: 'DELETE' },
  )
  if (!res.ok) {
    const raw = await parseJson(res)
    throw new Error(readApiErrorMessage(raw))
  }
}

export type QuizCurrentQuestionPayload = {
  question: QuizQuestion | null
  questionIndex: number
  totalQuestions: number
  completed: boolean
}

export async function fetchQuizCurrentQuestion(
  courseCode: string,
  itemId: string,
  attemptId: string,
): Promise<QuizCurrentQuestionPayload> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/quizzes/${encodeURIComponent(itemId)}/attempts/${encodeURIComponent(attemptId)}/current-question`,
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return parseApiResponse('fetchQuizCurrentQuestion', quizCurrentQuestionPayloadSchema, raw)
}

export async function postQuizAdvance(
  courseCode: string,
  itemId: string,
  attemptId: string,
  body: QuizQuestionResponseItem,
): Promise<{ locked: boolean; currentQuestionIndex: number; completed: boolean }> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/quizzes/${encodeURIComponent(itemId)}/attempts/${encodeURIComponent(attemptId)}/advance`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return parseApiResponse('postQuizAdvance', quizAdvanceResponseSchema, raw)
}

export type QuizHintRevealPayload = {
  level?: number | null
  body?: string | null
  mediaUrl?: string | null
  noMoreHints?: boolean
}

export async function postQuizQuestionHint(
  courseCode: string,
  itemId: string,
  attemptId: string,
  questionId: string,
): Promise<QuizHintRevealPayload> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/quizzes/${encodeURIComponent(itemId)}/attempts/${encodeURIComponent(attemptId)}/questions/${encodeURIComponent(questionId)}/hint`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    },
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return parseApiResponse('postQuizQuestionHint', quizHintRevealResponseSchema, raw)
}

export type QuizWorkedExamplePayload = {
  title?: string | null
  body?: string | null
  steps: { number: number; explanation: string; expression?: string | null }[]
}

export async function fetchQuizWorkedExample(
  courseCode: string,
  itemId: string,
  attemptId: string,
  questionId: string,
): Promise<QuizWorkedExamplePayload> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/quizzes/${encodeURIComponent(itemId)}/attempts/${encodeURIComponent(attemptId)}/questions/${encodeURIComponent(questionId)}/worked-example`,
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return parseApiResponse('fetchQuizWorkedExample', quizWorkedExampleResponseSchema, raw)
}

export type QuizCodeRunResult = {
  status: 'pass' | 'fail' | 'tle' | 'mle' | 're' | 'ce'
  passed: boolean
  actualOutput: string
  expectedOutput: string
  stderr?: string | null
  executionMs?: number | null
  memoryKb?: number | null
}

export type QuizCodeRunResponse = {
  questionId: string
  results: QuizCodeRunResult[]
  pointsEarned: number
  pointsPossible: number
}

export async function postQuizQuestionRun(
  courseCode: string,
  itemId: string,
  attemptId: string,
  questionId: string,
  body: { code: string; languageId?: number },
): Promise<QuizCodeRunResponse> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/quizzes/${encodeURIComponent(itemId)}/attempts/${encodeURIComponent(attemptId)}/questions/${encodeURIComponent(questionId)}/run`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: body.code,
        languageId: body.languageId,
      }),
    },
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return parseApiResponse('postQuizQuestionRun', quizCodeRunResponseSchema, raw)
}

export async function postQuizFocusLoss(
  courseCode: string,
  itemId: string,
  attemptId: string,
  body: { eventType: string; durationMs?: number | null },
): Promise<void> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/quizzes/${encodeURIComponent(itemId)}/attempts/${encodeURIComponent(attemptId)}/focus-loss`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventType: body.eventType, durationMs: body.durationMs }),
    },
  )
  if (res.ok || res.status === 204) return
  const raw = await parseJson(res)
  throw new Error(readApiErrorMessage(raw))
}

export type QuizFocusLossEventRow = {
  id: string
  eventType: string
  durationMs?: number | null
  createdAt: string
}

export async function fetchQuizFocusLossEvents(
  courseCode: string,
  itemId: string,
  attemptId: string,
): Promise<{ events: QuizFocusLossEventRow[]; total: number }> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/quizzes/${encodeURIComponent(itemId)}/attempts/${encodeURIComponent(attemptId)}/focus-loss-events`,
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return parseApiResponse('fetchQuizFocusLossEvents', quizFocusLossEventsResponseSchema, raw)
}

export type QuizQuestionResponseItem = {
  questionId: string
  selectedChoiceIndex?: number
  selectedChoiceIndices?: number[]
  textAnswer?: string | null
  matchingPairs?: { leftId: string; rightId: string }[]
  orderingSequence?: string[]
  hotspotClick?: { x: number; y: number }
  numericValue?: number
  formulaLatex?: string
  codeSubmission?: { language: string; code: string }
  fileKey?: string
  audioKey?: string
  videoKey?: string
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
  return parseApiResponse('postQuizSubmit', quizSubmitResponseSchema, raw)
}

export type QuizMisconceptionResult = {
  id: string
  name: string
  remediationBody?: string | null
  remediationUrl?: string | null
  recurrenceCount: number
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
  misconception?: QuizMisconceptionResult | null
}

export type QuizResultsPayload = {
  attemptId: string
  attemptNumber: number
  startedAt: string
  /** Set when kiosk focus-loss count exceeded the instructor threshold at submit. */
  academicIntegrityFlag?: boolean
  /** True when extended time from an accommodation was applied (instructor-visible). */
  extendedTimeActive?: boolean
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
  return parseApiResponse('fetchQuizResults', quizResultsPayloadSchema, raw)
}

export type MisconceptionReportRow = {
  misconceptionId: string
  misconceptionName: string
  questionId: string
  questionStem: string
  triggerCount: number
  affectedStudents: number
  firstSeenAt?: string | null
  lastSeenAt?: string | null
}

export async function fetchMisconceptionReport(
  courseCode: string,
): Promise<{ misconceptions: MisconceptionReportRow[] }> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/misconception-report`,
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return parseApiResponse('fetchMisconceptionReport', misconceptionReportResponseSchema, raw)
}

export type CourseMisconceptionRow = {
  id: string
  courseId: string
  conceptId?: string | null
  name: string
  description?: string | null
  remediationBody?: string | null
  remediationUrl?: string | null
  locale: string
  isSeed: boolean
}

export async function fetchCourseMisconceptions(
  courseCode: string,
  opts?: { conceptId?: string; q?: string; limit?: number },
): Promise<CourseMisconceptionRow[]> {
  const params = new URLSearchParams()
  if (opts?.conceptId) params.set('conceptId', opts.conceptId)
  if (opts?.q) params.set('q', opts.q)
  if (opts?.limit != null) params.set('limit', String(opts.limit))
  const qs = params.toString()
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/misconceptions${qs ? `?${qs}` : ''}`,
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  if (!Array.isArray(raw)) throw new Error('Invalid misconceptions response.')
  return raw.map((row, i) =>
    parseApiResponse(`fetchCourseMisconceptions[${i}]`, misconceptionRowSchema, row),
  )
}

export type CreateCourseMisconceptionBody = {
  name: string
  conceptId?: string | null
  description?: string | null
  remediationBody?: string | null
  remediationUrl?: string | null
  locale?: string
}

export async function createCourseMisconception(
  courseCode: string,
  body: CreateCourseMisconceptionBody,
): Promise<CourseMisconceptionRow> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/misconceptions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: body.name,
        conceptId: body.conceptId ?? undefined,
        description: body.description ?? undefined,
        remediationBody: body.remediationBody ?? undefined,
        remediationUrl: body.remediationUrl ?? undefined,
        locale: body.locale ?? undefined,
      }),
    },
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return parseApiResponse('createCourseMisconception', misconceptionRowSchema, raw)
}

export async function postImportMisconceptionSeedLibrary(
  courseCode: string,
  body?: { replaceExistingSeeds?: boolean },
): Promise<{ imported: number; skipped: number }> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/misconceptions/import-seed-library`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        replaceExistingSeeds: body?.replaceExistingSeeds ?? false,
      }),
    },
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return parseApiResponse(
    'postImportMisconceptionSeedLibrary',
    importMisconceptionSeedLibraryResponseSchema,
    raw,
  )
}

export async function putQuestionOptionMisconception(
  courseCode: string,
  questionId: string,
  optionId: string,
  body: { misconceptionId: string | null },
): Promise<void> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/questions/${encodeURIComponent(questionId)}/options/${encodeURIComponent(optionId)}/misconception`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        misconceptionId: body.misconceptionId,
      }),
    },
  )
  if (res.status === 204) return
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
}

export type AccommodationSummaryPayload = {
  hasAccommodation: boolean
  flags: string[]
}

export async function fetchEnrollmentAccommodationSummary(
  enrollmentId: string,
): Promise<AccommodationSummaryPayload> {
  const res = await authorizedFetch(
    `/api/v1/enrollments/${encodeURIComponent(enrollmentId)}/accommodation-summary`,
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return parseApiResponse('fetchEnrollmentAccommodationSummary', accommodationSummaryPayloadSchema, raw)
}

export type AccommodationUserSearchHit = {
  id: string
  email: string
  displayName?: string | null
  firstName?: string | null
  lastName?: string | null
  sid?: string | null
}

export async function searchAccommodationUsers(q: string): Promise<AccommodationUserSearchHit[]> {
  const params = new URLSearchParams({ q: q.trim() })
  const res = await authorizedFetch(`/api/v1/accommodations/users?${params}`)
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  const o = parseApiResponse('searchAccommodationUsers', accommodationUsersSearchResponseSchema, raw)
  return o.users ?? []
}

export type StudentAccommodationRecord = {
  id: string
  userId: string
  courseId?: string | null
  courseCode?: string | null
  timeMultiplier: number
  extraAttempts: number
  hintsAlwaysEnabled: boolean
  reducedDistractionMode: boolean
  alternativeFormat?: string | null
  effectiveFrom?: string | null
  effectiveUntil?: string | null
  createdBy: string
  updatedBy?: string | null
  createdAt: string
  updatedAt: string
}

export type CreateStudentAccommodationBody = {
  courseCode?: string | null
  timeMultiplier?: number
  extraAttempts?: number
  hintsAlwaysEnabled?: boolean
  reducedDistractionMode?: boolean
  alternativeFormat?: string | null
  effectiveFrom?: string | null
  effectiveUntil?: string | null
}

export async function fetchStudentAccommodationsForUser(
  userId: string,
): Promise<StudentAccommodationRecord[]> {
  const res = await authorizedFetch(`/api/v1/users/${encodeURIComponent(userId)}/accommodations`)
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return parseApiResponse('fetchStudentAccommodationsForUser', studentAccommodationRecordsListSchema, raw)
}

export async function createStudentAccommodation(
  userId: string,
  body: CreateStudentAccommodationBody,
): Promise<StudentAccommodationRecord> {
  const res = await authorizedFetch(`/api/v1/users/${encodeURIComponent(userId)}/accommodations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return parseApiResponse('createStudentAccommodation', studentAccommodationRecordSchema, raw)
}

export type UpdateStudentAccommodationBody = {
  timeMultiplier: number
  extraAttempts: number
  hintsAlwaysEnabled: boolean
  reducedDistractionMode: boolean
  alternativeFormat?: string | null
  effectiveFrom?: string | null
  effectiveUntil?: string | null
}

export async function updateStudentAccommodation(
  userId: string,
  accommodationId: string,
  body: UpdateStudentAccommodationBody,
): Promise<StudentAccommodationRecord> {
  const res = await authorizedFetch(
    `/api/v1/users/${encodeURIComponent(userId)}/accommodations/${encodeURIComponent(accommodationId)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return parseApiResponse('updateStudentAccommodation', studentAccommodationRecordSchema, raw)
}

export async function deleteStudentAccommodation(userId: string, accommodationId: string): Promise<void> {
  const res = await authorizedFetch(
    `/api/v1/users/${encodeURIComponent(userId)}/accommodations/${encodeURIComponent(accommodationId)}`,
    { method: 'DELETE' },
  )
  if (!res.ok) {
    const raw = await parseJson(res)
    throw new Error(readApiErrorMessage(raw))
  }
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
  const body = parseApiResponse('fetchReaderMarkups', readerMarkupsListResponseSchema, raw)
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
  return parseApiResponse('postReaderMarkup', contentPageMarkupSchema, raw)
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
    lateSubmissionPolicy?: LateSubmissionPolicy
    latePenaltyPercent?: number | null
    /** Set or clear assignment rubric (`null` removes). */
    rubric?: RubricDefinition | null
    blindGrading?: boolean
    moderatedGrading?: boolean
    moderationThresholdPct?: number
    moderatorUserId?: string | null
    provisionalGraderUserIds?: string[]
    originalityDetection?: OriginalityDetectionMode
    originalityStudentVisibility?: OriginalityStudentVisibility
    /** Plan 3.6 — set or clear (`null`) assignment display override. */
    gradingType?: string | null
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

/** Plan 3.5 — per-provider originality / AI signals for a submission. */
export type OriginalityReportApi = {
  provider: string
  status: string
  similarityPct: number | null
  aiProbability: number | null
  reportUrl: string | null
  reportToken?: string | null
  errorMessage?: string | null
}

function parseOriginalityReports(raw: unknown): OriginalityReportApi[] {
  if (!raw || typeof raw !== 'object') return []
  const reps = (raw as { reports?: unknown }).reports
  if (!Array.isArray(reps)) return []
  const out: OriginalityReportApi[] = []
  for (const row of reps) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    out.push({
      provider: typeof r.provider === 'string' ? r.provider : '',
      status: typeof r.status === 'string' ? r.status : '',
      similarityPct: typeof r.similarityPct === 'number' && Number.isFinite(r.similarityPct) ? r.similarityPct : null,
      aiProbability:
        typeof r.aiProbability === 'number' && Number.isFinite(r.aiProbability) ? r.aiProbability : null,
      reportUrl: typeof r.reportUrl === 'string' ? r.reportUrl : null,
      reportToken: typeof r.reportToken === 'string' ? r.reportToken : null,
      errorMessage: typeof r.errorMessage === 'string' ? r.errorMessage : null,
    })
  }
  return out
}

export async function fetchSubmissionOriginality(
  courseCode: string,
  itemId: string,
  submissionId: string,
): Promise<OriginalityReportApi[] | null> {
  const url = `/api/v1/courses/${encodeURIComponent(courseCode)}/assignments/${encodeURIComponent(itemId)}/submissions/${encodeURIComponent(submissionId)}/originality`
  const res = await authorizedFetch(url)
  if (res.status === 404) return null
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return parseOriginalityReports(raw)
}

export async function fetchSubmissionOriginalityEmbedUrl(
  courseCode: string,
  itemId: string,
  submissionId: string,
): Promise<string> {
  const url = `/api/v1/courses/${encodeURIComponent(courseCode)}/assignments/${encodeURIComponent(itemId)}/submissions/${encodeURIComponent(submissionId)}/originality/embed-url`
  const res = await authorizedFetch(url)
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  const embedUrl = (raw as { embedUrl?: unknown }).embedUrl
  if (typeof embedUrl !== 'string' || !embedUrl.trim()) {
    throw new Error('No embed URL returned.')
  }
  return embedUrl.trim()
}

/** Plan 3.4 — roster for moderator / grader pickers (course staff only). */
export type CourseEnrollmentRosterRow = {
  id: string
  userId: string
  displayName: string | null
  role: string
}

export async function fetchCourseEnrollmentsList(
  courseCode: string,
): Promise<CourseEnrollmentRosterRow[]> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/enrollments`,
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  const er = (raw as { enrollments?: unknown }).enrollments
  if (!Array.isArray(er)) return []
  const out: CourseEnrollmentRosterRow[] = []
  for (const row of er) {
    if (!row || typeof row !== 'object') continue
    const o = row as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id : null
    const userId = typeof o.userId === 'string' ? o.userId : null
    const role = typeof o.role === 'string' ? o.role : ''
    if (!id || !userId) continue
    const displayName = typeof o.displayName === 'string' ? o.displayName : null
    out.push({ id, userId, displayName, role })
  }
  return out
}

export type ModerationProvisionalGrade = {
  submissionId: string
  graderId: string
  score: number
  submittedAt: string | null
}

export async function fetchProvisionalGrades(
  courseCode: string,
  itemId: string,
): Promise<ModerationProvisionalGrade[]> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/assignments/${encodeURIComponent(itemId)}/provisional-grades`,
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  const list = (raw as { provisionalGrades?: unknown }).provisionalGrades
  if (!Array.isArray(list)) return []
  const out: ModerationProvisionalGrade[] = []
  for (const row of list) {
    if (!row || typeof row !== 'object') continue
    const o = row as Record<string, unknown>
    const submissionId = typeof o.submissionId === 'string' ? o.submissionId : null
    const graderId = typeof o.graderId === 'string' ? o.graderId : null
    const score = typeof o.score === 'number' && Number.isFinite(o.score) ? o.score : NaN
    if (!submissionId || !graderId || !Number.isFinite(score)) continue
    const submittedAt = typeof o.submittedAt === 'string' ? o.submittedAt : null
    out.push({ submissionId, graderId, score, submittedAt })
  }
  return out
}

export async function postProvisionalGrade(
  courseCode: string,
  itemId: string,
  submissionId: string,
  body: { score: number },
): Promise<void> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/assignments/${encodeURIComponent(itemId)}/submissions/${encodeURIComponent(submissionId)}/provisional-grades`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ score: body.score }),
    },
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
}

export type ModerationReconciliationRow = {
  submissionId: string
  studentUserId: string
  provisional: ModerationProvisionalGrade[]
  flagged: boolean
  pointsWorth: number | null
  finalScore: number | null
  reconciliationSource: string | null
}

export async function fetchModerationReconciliation(
  courseCode: string,
  itemId: string,
): Promise<{ rows: ModerationReconciliationRow[]; unreconciledFlaggedCount: number }> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/assignments/${encodeURIComponent(itemId)}/reconciliation`,
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  const rowsRaw = (raw as { rows?: unknown }).rows
  const rows: ModerationReconciliationRow[] = []
  if (Array.isArray(rowsRaw)) {
    for (const row of rowsRaw) {
      if (!row || typeof row !== 'object') continue
      const o = row as Record<string, unknown>
      const submissionId = typeof o.submissionId === 'string' ? o.submissionId : null
      const studentUserId = typeof o.studentUserId === 'string' ? o.studentUserId : null
      if (!submissionId || !studentUserId) continue
      const provisional: ModerationProvisionalGrade[] = []
      const pv = o.provisional
      if (Array.isArray(pv)) {
        for (const p of pv) {
          if (!p || typeof p !== 'object') continue
          const pr = p as Record<string, unknown>
          const sid = typeof pr.submissionId === 'string' ? pr.submissionId : null
          const gid = typeof pr.graderId === 'string' ? pr.graderId : null
          const sc = typeof pr.score === 'number' && Number.isFinite(pr.score) ? pr.score : NaN
          if (!sid || !gid || !Number.isFinite(sc)) continue
          provisional.push({
            submissionId: sid,
            graderId: gid,
            score: sc,
            submittedAt: typeof pr.submittedAt === 'string' ? pr.submittedAt : null,
          })
        }
      }
      rows.push({
        submissionId,
        studentUserId,
        provisional,
        flagged: Boolean(o.flagged),
        pointsWorth: typeof o.pointsWorth === 'number' ? o.pointsWorth : null,
        finalScore: typeof o.finalScore === 'number' && Number.isFinite(o.finalScore) ? o.finalScore : null,
        reconciliationSource:
          typeof o.reconciliationSource === 'string' ? o.reconciliationSource : null,
      })
    }
  }
  const rawObj = raw as Record<string, unknown>
  const ufc = rawObj.unreconciledFlaggedCount
  const unreconciledFlaggedCount =
    typeof ufc === 'number' && Number.isFinite(ufc) ? ufc : 0
  return { rows, unreconciledFlaggedCount }
}

export async function postModerationReconcile(
  courseCode: string,
  itemId: string,
  submissionId: string,
  body: {
    action: 'accept_grader' | 'average' | 'override' | 'single'
    graderId?: string
    overrideScore?: number
  },
): Promise<void> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/assignments/${encodeURIComponent(itemId)}/submissions/${encodeURIComponent(submissionId)}/reconcile`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
}

/** POST `/assignments/:itemId/generate-rubric` — AI draft rubric (not persisted until assignment save). */
export async function generateAssignmentRubric(
  courseCode: string,
  itemId: string,
  body: { prompt: string; assignmentMarkdown: string },
): Promise<{ rubric: RubricDefinition }> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/assignments/${encodeURIComponent(itemId)}/generate-rubric`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: body.prompt, assignmentMarkdown: body.assignmentMarkdown }),
    },
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  const o = raw as { rubric?: unknown }
  const rubric = parseRubricDefinition(o.rubric)
  if (!rubric) throw new Error('The AI did not return a usable rubric.')
  return { rubric }
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
  return parseApiResponse('fetchCourseSyllabus', courseSyllabusPayloadSchema, raw)
}

export async function fetchSyllabusAcceptanceStatus(
  courseCode: string,
): Promise<SyllabusAcceptanceStatus> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/syllabus/acceptance-status`,
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return parseApiResponse('fetchSyllabusAcceptanceStatus', syllabusAcceptanceStatusSchema, raw)
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
  return parseApiResponse('patchCourseSyllabus', courseSyllabusPayloadSchema, raw)
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
  return parseApiResponse('generateSyllabusSectionMarkdown', generatedSyllabusSectionMarkdownSchema, raw)
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

export type CourseGradingSchemeRecord = {
  id: string
  name: string
  type: string
  scaleJson: unknown
}

export async function fetchCourseGradingScheme(
  courseCode: string,
): Promise<{ scheme: CourseGradingSchemeRecord | null }> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/grading-scheme`,
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  const body = parseApiResponse('fetchCourseGradingScheme', courseGradingSchemeEnvelopeSchema, raw)
  return { scheme: body.scheme ?? null }
}

export async function putCourseGradingScheme(
  courseCode: string,
  body: { name?: string; type: string; scaleJson?: unknown },
): Promise<{ scheme: CourseGradingSchemeRecord | null }> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/grading-scheme`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(body.name != null ? { name: body.name } : {}),
        type: body.type,
        ...(body.scaleJson !== undefined ? { scaleJson: body.scaleJson } : {}),
      }),
    },
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  const out = parseApiResponse('putCourseGradingScheme', courseGradingSchemeEnvelopeSchema, raw)
  return { scheme: out.scheme ?? null }
}

/** GET `/outcomes` — learning outcomes, evidence links, and class-level progress. */
export type CourseOutcomeLinkProgress = {
  avgScorePercent: number | null
  gradedLearners: number
  enrolledLearners: number
}

/** Must match server `course_outcome_links` check constraint. */
export const OUTCOME_MEASUREMENT_LEVEL_IDS = [
  'diagnostic',
  'formative',
  'summative',
  'performance',
] as const
export type OutcomeMeasurementLevelId = (typeof OUTCOME_MEASUREMENT_LEVEL_IDS)[number]

export const OUTCOME_INTENSITY_LEVEL_IDS = ['low', 'medium', 'high'] as const
export type OutcomeIntensityLevelId = (typeof OUTCOME_INTENSITY_LEVEL_IDS)[number]

export type CourseOutcomeLink = {
  id: string
  subOutcomeId?: string
  structureItemId: string
  targetKind: 'assignment' | 'quiz' | 'quiz_question'
  quizQuestionId: string
  measurementLevel: OutcomeMeasurementLevelId | string
  intensityLevel: OutcomeIntensityLevelId | string
  itemTitle: string
  itemKind: string
  progress: CourseOutcomeLinkProgress
}

export type CourseOutcome = {
  id: string
  title: string
  description: string
  sortOrder: number
  rollupAvgScorePercent: number | null
  links: CourseOutcomeLink[]
}

export type CourseOutcomesListResponse = {
  enrolledLearners: number
  outcomes: CourseOutcome[]
}

export async function fetchCourseOutcomes(courseCode: string): Promise<CourseOutcomesListResponse> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/outcomes`,
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return parseApiResponse('fetchCourseOutcomes', courseOutcomesListResponseSchema, raw)
}

export type CourseOutcomeSubOutcome = {
  id: string
  outcomeId: string
  title: string
  description: string
  sortOrder: number
}

export async function createCourseOutcomeSubOutcome(
  courseCode: string,
  outcomeId: string,
  body: { title: string; description?: string },
): Promise<CourseOutcomeSubOutcome> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/outcomes/${encodeURIComponent(outcomeId)}/sub-outcomes`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: body.title, description: body.description ?? '' }),
    },
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return parseApiResponse('createCourseOutcomeSubOutcome', courseOutcomeSubOutcomeSchema, raw)
}

export async function createCourseOutcome(
  courseCode: string,
  body: { title: string; description?: string },
): Promise<CourseOutcome> {
  const res = await authorizedFetch(`/api/v1/courses/${encodeURIComponent(courseCode)}/outcomes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: body.title, description: body.description ?? '' }),
  })
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return parseApiResponse('createCourseOutcome', courseOutcomeSchema, raw)
}

export async function patchCourseOutcome(
  courseCode: string,
  outcomeId: string,
  body: { title?: string; description?: string; moduleStructureItemId?: string | null },
): Promise<CourseOutcome> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/outcomes/${encodeURIComponent(outcomeId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return parseApiResponse('patchCourseOutcome', courseOutcomeSchema, raw)
}

export async function deleteCourseOutcome(courseCode: string, outcomeId: string): Promise<void> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/outcomes/${encodeURIComponent(outcomeId)}`,
    { method: 'DELETE' },
  )
  if (!res.ok) {
    const raw = await parseJson(res)
    throw new Error(readApiErrorMessage(raw))
  }
}

export async function addCourseOutcomeLink(
  courseCode: string,
  outcomeId: string,
  body: {
    structureItemId: string
    targetKind: string
    quizQuestionId?: string
    measurementLevel?: string
    intensityLevel?: string
    subOutcomeId?: string
  },
): Promise<CourseOutcomeLink> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/outcomes/${encodeURIComponent(outcomeId)}/links`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return parseApiResponse('addCourseOutcomeLink', courseOutcomeLinkSchema, raw)
}

export async function deleteCourseOutcomeLink(
  courseCode: string,
  outcomeId: string,
  linkId: string,
): Promise<void> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/outcomes/${encodeURIComponent(outcomeId)}/links/${encodeURIComponent(linkId)}`,
    { method: 'DELETE' },
  )
  if (!res.ok) {
    const raw = await parseJson(res)
    throw new Error(readApiErrorMessage(raw))
  }
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
  return parseApiResponse('CourseStructureItem', courseStructureItemSchema, raw)
}

export async function fetchCourseScopedRoles(courseCode: string): Promise<CourseScopedAppRole[]> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/course-scoped-roles`,
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  const data = parseApiResponse('fetchCourseScopedRoles', courseScopedRolesResponseSchema, raw)
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
  return parseApiResponse('fetchCourseExport', courseExportBundleSchema, raw)
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

/** Mirrors server `CanvasImportInclude`; all default true when omitted. */
export type CanvasImportInclude = {
  modules: boolean
  assignments: boolean
  quizzes: boolean
  enrollments: boolean
  grades: boolean
  settings: boolean
}

export const CANVAS_IMPORT_INCLUDE_ALL: CanvasImportInclude = {
  modules: true,
  assignments: true,
  quizzes: true,
  enrollments: true,
  grades: true,
  settings: true,
}

export type PostCourseImportCanvasBody = {
  mode: CourseBundleImportMode
  canvasBaseUrl: string
  canvasCourseId: string
  accessToken: string
  /** When omitted, every category is imported (server default). */
  include?: CanvasImportInclude
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
          include: body.include ?? CANVAS_IMPORT_INCLUDE_ALL,
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

/** Row from `/assignments/:itemId/submissions` (plan 3.1). */
export type ModuleAssignmentSubmissionApi = {
  id: string
  /** Omitted when blind grading hides student identity (plan 3.3). */
  submittedBy?: string
  /** Set when blind grading is active (plan 3.3). */
  blindLabel?: string
  attachmentFileId: string | null
  submittedAt: string
  updatedAt: string
  attachmentContentPath?: string | null
  attachmentMimeType?: string | null
}

export type SubmissionAnnotationApi = {
  id: string
  submissionId: string
  annotatorId: string
  clientId: string
  page: number
  toolType: string
  colour: string
  coordsJson: unknown
  body?: string | null
  createdAt: string
  updatedAt: string
}

export async function fetchModuleAssignmentMySubmission(
  courseCode: string,
  itemId: string,
): Promise<ModuleAssignmentSubmissionApi | null> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/assignments/${encodeURIComponent(itemId)}/submissions/mine`,
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  const o = raw as { submission?: ModuleAssignmentSubmissionApi | null }
  if (o.submission == null || o.submission === undefined) return null
  return o.submission
}

/** POST `/assignments/:itemId/reveal-identities` — course creator only (plan 3.3). */
export async function revealModuleAssignmentIdentities(
  courseCode: string,
  itemId: string,
  opts?: { force?: boolean },
): Promise<{ ok: boolean; identitiesRevealedAt: string; alreadyRevealed?: boolean }> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/assignments/${encodeURIComponent(itemId)}/reveal-identities`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: opts?.force ?? false }),
    },
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  const o = raw as {
    ok?: boolean
    identitiesRevealedAt?: string
    alreadyRevealed?: boolean
  }
  if (!o.ok || typeof o.identitiesRevealedAt !== 'string') {
    throw new Error('Unexpected response when revealing identities.')
  }
  return {
    ok: true,
    identitiesRevealedAt: o.identitiesRevealedAt,
    alreadyRevealed: o.alreadyRevealed === true,
  }
}

export async function fetchModuleAssignmentSubmissions(
  courseCode: string,
  itemId: string,
  opts?: { graded?: 'all' | 'graded' | 'ungraded' },
): Promise<ModuleAssignmentSubmissionApi[]> {
  const q =
    opts?.graded && opts.graded !== 'all' ? `?graded=${encodeURIComponent(opts.graded)}` : ''
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/assignments/${encodeURIComponent(itemId)}/submissions${q}`,
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  const o = raw as { submissions?: ModuleAssignmentSubmissionApi[] }
  return Array.isArray(o.submissions) ? o.submissions : []
}

export async function uploadModuleAssignmentSubmissionFile(
  courseCode: string,
  itemId: string,
  file: File,
): Promise<{ submission: ModuleAssignmentSubmissionApi }> {
  const fd = new FormData()
  fd.set('file', file)
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/assignments/${encodeURIComponent(itemId)}/submissions/upload`,
    { method: 'POST', body: fd },
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw as { submission: ModuleAssignmentSubmissionApi }
}

export async function fetchSubmissionAnnotations(
  courseCode: string,
  itemId: string,
  submissionId: string,
): Promise<SubmissionAnnotationApi[]> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/assignments/${encodeURIComponent(itemId)}/submissions/${encodeURIComponent(submissionId)}/annotations`,
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  const o = raw as { annotations?: SubmissionAnnotationApi[] }
  return Array.isArray(o.annotations) ? o.annotations : []
}

export type PostSubmissionAnnotationInput = {
  clientId: string
  page: number
  toolType: 'highlight' | 'draw' | 'text' | 'pin'
  colour: string
  coordsJson: unknown
  body?: string
}

export async function postSubmissionAnnotation(
  courseCode: string,
  itemId: string,
  submissionId: string,
  body: PostSubmissionAnnotationInput,
): Promise<SubmissionAnnotationApi> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/assignments/${encodeURIComponent(itemId)}/submissions/${encodeURIComponent(submissionId)}/annotations`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: body.clientId,
        page: body.page,
        toolType: body.toolType,
        colour: body.colour,
        coordsJson: body.coordsJson,
        body: body.body,
      }),
    },
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  const o = raw as { annotation?: SubmissionAnnotationApi }
  if (!o.annotation) throw new Error('Invalid annotation response.')
  return o.annotation
}

export async function deleteSubmissionAnnotation(
  courseCode: string,
  itemId: string,
  submissionId: string,
  annotationId: string,
): Promise<void> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/assignments/${encodeURIComponent(itemId)}/submissions/${encodeURIComponent(submissionId)}/annotations/${encodeURIComponent(annotationId)}`,
    { method: 'DELETE' },
  )
  if (res.ok) return
  const raw = await parseJson(res)
  throw new Error(readApiErrorMessage(raw))
}

/** Plan 3.2 — instructor/student feedback media on a submission. */
export type SubmissionFeedbackMediaApi = {
  id: string
  mediaType: 'audio' | 'video'
  mimeType: string
  durationSecs?: number | null
  captionStatus: string
  contentPath: string
  createdAt: string
}

export async function fetchSubmissionFeedbackMedia(
  courseCode: string,
  itemId: string,
  submissionId: string,
): Promise<SubmissionFeedbackMediaApi[]> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/assignments/${encodeURIComponent(itemId)}/submissions/${encodeURIComponent(submissionId)}/feedback-media`,
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  const o = raw as { items?: unknown }
  if (!Array.isArray(o.items)) return []
  return o.items as SubmissionFeedbackMediaApi[]
}

export async function uploadSubmissionFeedbackMediaMultipart(
  courseCode: string,
  itemId: string,
  submissionId: string,
  blob: Blob,
  fileName: string,
  durationSecs?: number,
): Promise<{ media: SubmissionFeedbackMediaApi }> {
  const fd = new FormData()
  fd.set('file', blob, fileName)
  if (durationSecs != null) fd.set('durationSecs', String(durationSecs))
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/assignments/${encodeURIComponent(itemId)}/submissions/${encodeURIComponent(submissionId)}/feedback-media/upload`,
    { method: 'POST', body: fd },
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw as { media: SubmissionFeedbackMediaApi }
}

export async function initiateSubmissionFeedbackUpload(
  courseCode: string,
  itemId: string,
  submissionId: string,
  body: { mimeType: string; mediaType: 'audio' | 'video'; byteSize: number },
): Promise<{ mediaId: string; chunkSize: number; uploadPath: string }> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/assignments/${encodeURIComponent(itemId)}/submissions/${encodeURIComponent(submissionId)}/feedback-media/initiate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mimeType: body.mimeType,
        mediaType: body.mediaType,
        byteSize: body.byteSize,
      }),
    },
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw as { mediaId: string; chunkSize: number; uploadPath: string }
}

export async function putSubmissionFeedbackChunk(
  uploadPath: string,
  chunk: ArrayBuffer,
  offset: number,
  accessToken: string,
): Promise<void> {
  const r = await fetch(apiUrl(uploadPath), {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'X-Upload-Offset': String(offset),
      'Content-Type': 'application/octet-stream',
    },
    body: chunk,
  })
  if (r.status === 204) return
  const raw = await r.json().catch(() => ({}))
  throw new Error(
    raw && typeof raw === 'object' && 'message' in raw
      ? String((raw as { message?: string }).message)
      : `Upload failed (${r.status})`,
  )
}

export async function completeSubmissionFeedbackUpload(
  courseCode: string,
  itemId: string,
  submissionId: string,
  mediaId: string,
  durationSecs?: number,
): Promise<{ media: SubmissionFeedbackMediaApi }> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/assignments/${encodeURIComponent(itemId)}/submissions/${encodeURIComponent(submissionId)}/feedback-media/${encodeURIComponent(mediaId)}/complete`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ durationSecs }),
    },
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw as { media: SubmissionFeedbackMediaApi }
}

export async function getSubmissionFeedbackPlaybackInfo(
  courseCode: string,
  itemId: string,
  submissionId: string,
  mediaId: string,
): Promise<{ contentPath: string; captionPath?: string; expiresAt: string }> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/assignments/${encodeURIComponent(itemId)}/submissions/${encodeURIComponent(submissionId)}/feedback-media/${encodeURIComponent(mediaId)}/url`,
  )
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw as { contentPath: string; captionPath?: string; expiresAt: string }
}

export async function deleteSubmissionFeedbackMedia(
  courseCode: string,
  itemId: string,
  submissionId: string,
  mediaId: string,
): Promise<void> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/assignments/${encodeURIComponent(itemId)}/submissions/${encodeURIComponent(submissionId)}/feedback-media/${encodeURIComponent(mediaId)}`,
    { method: 'DELETE' },
  )
  if (res.status === 204) return
  const raw = await parseJson(res)
  throw new Error(readApiErrorMessage(raw))
}

export async function downloadSubmissionAnnotatedPdf(
  courseCode: string,
  itemId: string,
  submissionId: string,
): Promise<void> {
  const res = await authorizedFetch(
    `/api/v1/courses/${encodeURIComponent(courseCode)}/assignments/${encodeURIComponent(itemId)}/submissions/${encodeURIComponent(submissionId)}/annotated-pdf`,
  )
  if (!res.ok) {
    const raw = await parseJson(res)
    throw new Error(readApiErrorMessage(raw))
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'annotated-submission.pdf'
  a.rel = 'noopener'
  a.click()
  URL.revokeObjectURL(url)
}
