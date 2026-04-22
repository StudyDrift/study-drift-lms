import { z } from 'zod'

/** Validates successful JSON responses from `/api/v1/courses/*` and related endpoints. */
export function parseApiResponse<T>(context: string, schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw)
  if (!result.success) {
    throw new Error(`Invalid API response (${context}): ${result.error.message}`)
  }
  return result.data
}

const markdownThemeCustomSchema = z
  .object({
    headingColor: z.string().optional(),
    bodyColor: z.string().optional(),
    linkColor: z.string().optional(),
    codeBackground: z.string().optional(),
    blockquoteBorder: z.string().optional(),
    articleWidth: z.enum(['narrow', 'comfortable', 'wide', 'full']).optional(),
    fontFamily: z.enum(['sans', 'serif']).optional(),
  })
  .strict()

/** Validates the public course JSON shape (client `CoursePublic` / server `CoursePublic`). */
export const courseSchema = z
  .object({
    id: z.string(),
    courseCode: z.string(),
    title: z.string(),
    description: z.string(),
    heroImageUrl: z.string().nullable(),
    heroImageObjectPosition: z.string().nullable(),
    startsAt: z.string().nullable(),
    endsAt: z.string().nullable(),
    visibleFrom: z.string().nullable(),
    hiddenAt: z.string().nullable(),
    scheduleMode: z.string().optional(),
    relativeEndAfter: z.string().nullable().optional(),
    relativeHiddenAfter: z.string().nullable().optional(),
    relativeScheduleAnchorAt: z.string().nullable().optional(),
    published: z.boolean(),
    archived: z.boolean(),
    markdownThemePreset: z.string(),
    markdownThemeCustom: z.union([markdownThemeCustomSchema, z.null()]).optional(),
    gradingScale: z.string(),
    notebookEnabled: z.boolean().optional(),
    feedEnabled: z.boolean().optional(),
    calendarEnabled: z.boolean().optional(),
    questionBankEnabled: z.boolean().optional(),
    lockdownModeEnabled: z.boolean().optional(),
    standardsAlignmentEnabled: z.boolean().optional(),
    sbgEnabled: z.boolean().optional(),
    sbgProficiencyScaleJson: z.unknown().nullish().optional(),
    sbgAggregationRule: z.string().optional(),
    adaptivePathsEnabled: z.boolean().optional(),
    srsEnabled: z.boolean().optional(),
    diagnosticAssessmentsEnabled: z.boolean().optional(),
    hintScaffoldingEnabled: z.boolean().optional(),
    misconceptionDetectionEnabled: z.boolean().optional(),
    courseType: z.string().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
    viewerEnrollmentRoles: z.array(z.string()).optional(),
    viewerStudentEnrollmentId: z.string().optional(),
    annotationsEnabled: z.boolean().optional(),
    feedbackMediaEnabled: z.boolean().optional(),
  })
  .passthrough()
  .transform((c) => ({
    ...c,
    markdownThemeCustom: c.markdownThemeCustom ?? null,
    annotationsEnabled: c.annotationsEnabled ?? false,
    feedbackMediaEnabled: c.feedbackMediaEnabled ?? false,
    sbgEnabled: c.sbgEnabled ?? false,
  }))

export const assignmentGroupSchema = z.object({
  id: z.string(),
  sortOrder: z.number(),
  name: z.string(),
  weightPercent: z.number(),
  dropLowest: z.number().optional().default(0),
  dropHighest: z.number().optional().default(0),
  replaceLowestWithFinal: z.boolean().optional().default(false),
})

export const courseGradingSettingsResultSchema = z.object({
  gradingScale: z.string(),
  assignmentGroups: z.array(assignmentGroupSchema),
  sbgEnabled: z.boolean().optional(),
  sbgProficiencyScaleJson: z.unknown().nullish().optional(),
  sbgAggregationRule: z.string().optional(),
})

export const bankQuestionRowSchema = z.object({
  id: z.string(),
  courseId: z.string(),
  questionType: z.string(),
  stem: z.string(),
  status: z.string(),
  points: z.number(),
  shared: z.boolean(),
  source: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  versionNumber: z.number(),
  isPublished: z.boolean(),
  srsEligible: z.boolean().optional(),
})

export const questionOptionMisconceptionTagSchema = z.object({
  optionId: z.string(),
  misconceptionId: z.string(),
})

export const bankQuestionDetailSchema = bankQuestionRowSchema.extend({
  options: z.unknown().optional(),
  correctAnswer: z.unknown().optional(),
  explanation: z.string().nullable().optional(),
  metadata: z.unknown().optional(),
  irtA: z.number().nullable().optional(),
  irtB: z.number().nullable().optional(),
  irtStatus: z.string().optional(),
  createdBy: z.string().nullable().optional(),
  shuffleChoicesOverride: z.boolean().nullable().optional(),
  optionMisconceptionTags: z.array(questionOptionMisconceptionTagSchema).optional(),
})

export const reviewQueueItemSchema = z.object({
  stateId: z.string(),
  questionId: z.string(),
  courseId: z.string(),
  courseCode: z.string(),
  courseTitle: z.string(),
  nextReviewAt: z.string(),
  stem: z.string(),
  questionType: z.string(),
  options: z.unknown().optional(),
  correctAnswer: z.unknown().optional(),
  explanation: z.string().nullable().optional(),
})

export const reviewQueueResponseSchema = z.object({
  items: z.array(reviewQueueItemSchema),
  totalDue: z.number(),
})

export const reviewStatsResponseSchema = z.object({
  streak: z.number(),
  dueToday: z.number(),
  dueWeek: z.number(),
  retentionEstimate: z.number(),
})

export const recommendationItemSchema = z.object({
  itemId: z.string(),
  itemType: z.string(),
  title: z.string(),
  surface: z.string(),
  reason: z.string(),
  score: z.number(),
})

export const learnerRecommendationsResponseSchema = z.object({
  recommendations: z.array(recommendationItemSchema),
  degraded: z.boolean().optional(),
})

export const bankQuestionVersionSummarySchema = z.object({
  versionNumber: z.number(),
  changeNote: z.string().nullable().optional(),
  changeSummary: z.unknown().optional(),
  createdBy: z.string().nullable().optional(),
  createdAt: z.string(),
})

export const courseFileUploadResponseSchema = z
  .object({
    id: z.string(),
    content_path: z.string(),
    mime_type: z.string(),
    byte_size: z.number(),
  })
  .transform((o) => ({
    id: o.id,
    contentPath: o.content_path,
    mimeType: o.mime_type,
    byteSize: o.byte_size,
  }))

export const enrollmentGroupTreeSchema = z.object({
  id: z.string(),
  name: z.string(),
  sortOrder: z.number(),
  enrollmentIds: z.array(z.string()),
})

export const enrollmentGroupSetTreeSchema = z.object({
  id: z.string(),
  name: z.string(),
  sortOrder: z.number(),
  groups: z.array(enrollmentGroupTreeSchema),
})

export const enrollmentGroupsTreeResponseSchema = z.object({
  groupSets: z.array(enrollmentGroupSetTreeSchema),
})

export const idResponseSchema = z.object({ id: z.string() })

export const courseStructureItemSchema = z
  .object({
    id: z.string(),
    sortOrder: z.number(),
    kind: z.enum([
      'module',
      'heading',
      'content_page',
      'assignment',
      'quiz',
      'external_link',
      'survey',
      'lti_link',
    ]),
    title: z.string(),
    parentId: z.string().nullable(),
    published: z.boolean(),
    visibleFrom: z.string().nullable(),
    archived: z.boolean().optional(),
    dueAt: z.string().nullable(),
    assignmentGroupId: z.string().nullable(),
    isAdaptive: z.boolean().optional(),
    pointsPossible: z.number().optional(),
    pointsWorth: z.number().nullable().optional(),
    externalUrl: z.string().nullable().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .passthrough()

export const courseStructureItemsResponseSchema = z.object({
  items: z.array(courseStructureItemSchema),
})

export const structurePathRuleSchema = z.object({
  id: z.string(),
  structureItemId: z.string(),
  ruleType: z.string(),
  conceptIds: z.array(z.string()),
  threshold: z.number(),
  targetItemId: z.string().nullable().optional(),
  priority: z.number(),
  createdAt: z.string(),
})

export const structurePathRulesResponseSchema = z.array(structurePathRuleSchema)

export const pathConceptOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
})

export const pathConceptsResponseSchema = z.array(pathConceptOptionSchema)

export const enrollmentNextResponseSchema = z.object({
  item: courseStructureItemSchema,
  skipReason: z.string().optional(),
  skipReasonKey: z.string().optional(),
  fallback: z.boolean().optional(),
})

export const adaptivePathPreviewResponseSchema = z.object({
  path: z.array(z.string()),
  fallback: z.boolean().optional(),
})

const rubricLevelSchema = z.object({
  label: z.string(),
  points: z.number(),
  description: z.string().nullable().optional(),
})

const rubricCriterionSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  levels: z.array(rubricLevelSchema),
})

const rubricDefinitionSchema = z.object({
  title: z.string().nullable().optional(),
  criteria: z.array(rubricCriterionSchema),
})

export const courseGradebookGridColumnSchema = z.object({
  id: z.string(),
  kind: z.string(),
  title: z.string(),
  maxPoints: z.number().nullable(),
  assignmentGroupId: z.string().nullable().optional(),
  rubric: rubricDefinitionSchema.nullable().optional(),
  assignmentGradingType: z.string().nullable().optional(),
  effectiveDisplayType: z.string().optional(),
  postingPolicy: z.string().nullable().optional(),
  releaseAt: z.string().nullable().optional(),
  neverDrop: z.boolean().optional().default(false),
  replaceWithFinal: z.boolean().optional().default(false),
})

export const courseGradebookGridResponseSchema = z.object({
  students: z.array(
    z.object({
      userId: z.string(),
      displayName: z.string(),
    }),
  ),
  columns: z.array(courseGradebookGridColumnSchema),
  grades: z.record(z.string(), z.record(z.string(), z.string())).optional(),
  displayGrades: z.record(z.string(), z.record(z.string(), z.string())).optional(),
  rubricScores: z
    .record(z.string(), z.record(z.string(), z.record(z.string(), z.string())))
    .optional(),
  gradeHeld: z
    .record(z.string(), z.record(z.string(), z.boolean()))
    .optional(),
  droppedGrades: z
    .record(z.string(), z.record(z.string(), z.boolean()))
    .optional(),
  gradingScheme: z
    .object({
      type: z.string(),
      scaleJson: z.unknown(),
    })
    .optional(),
})

/** Raw `/my-grades` body before `assignmentGroups` is normalized via `parseCourseGradingSettings`. */
export const courseMyGradesRawSchema = z.object({
  columns: z.array(courseGradebookGridColumnSchema).optional(),
  grades: z.record(z.string(), z.string()).optional(),
  displayGrades: z.record(z.string(), z.string()).optional(),
  heldGradeItemIds: z.array(z.string()).optional(),
  droppedGrades: z.record(z.string(), z.boolean()).optional(),
  assignmentGroups: z.unknown().optional(),
  gradingScheme: z
    .object({
      type: z.string(),
      scaleJson: z.unknown(),
    })
    .optional(),
})

export const courseGradingSchemeEnvelopeSchema = z.object({
  scheme: z
    .object({
      id: z.string(),
      name: z.string(),
      type: z.string(),
      scaleJson: z.unknown(),
    })
    .nullable()
    .optional(),
})

export const quizQuestionSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  questionType: z.enum([
    'multiple_choice',
    'fill_in_blank',
    'essay',
    'true_false',
    'short_answer',
    'matching',
    'ordering',
    'hotspot',
    'numeric',
    'formula',
    'code',
    'file_upload',
    'audio_response',
    'video_response',
  ]),
  choices: z.array(z.string()),
  typeConfig: z.record(z.string(), z.unknown()).optional(),
  correctChoiceIndex: z.number().nullable(),
  multipleAnswer: z.boolean(),
  answerWithImage: z.boolean(),
  required: z.boolean(),
  points: z.number(),
  estimatedMinutes: z.number(),
})

export const generateQuizQuestionsResponseSchema = z.object({
  questions: z.array(quizQuestionSchema),
})

const adaptiveQuizGeneratedQuestionSchema = z.object({
  questionId: z.string().uuid().optional(),
  prompt: z.string(),
  questionType: z.string(),
  choices: z.array(z.string()),
  choiceWeights: z.array(z.number()),
  multipleAnswer: z.boolean(),
  answerWithImage: z.boolean(),
  required: z.boolean(),
  points: z.number(),
  estimatedMinutes: z.number(),
})

export const adaptiveQuizNextResponseSchema = z.discriminatedUnion('finished', [
  z.object({
    finished: z.literal(true),
    message: z.string().nullable().optional(),
    questions: z.array(adaptiveQuizGeneratedQuestionSchema).optional(),
  }),
  z.object({
    finished: z.literal(false),
    questions: z.array(adaptiveQuizGeneratedQuestionSchema),
  }),
])

export const quizAttemptStartResponseSchema = z.object({
  attemptId: z.string(),
  attemptNumber: z.number(),
  startedAt: z.string(),
  lockdownMode: z.preprocess(
    (v) => (v === 'one_at_a_time' || v === 'kiosk' ? v : 'standard'),
    z.enum(['standard', 'one_at_a_time', 'kiosk']),
  ),
  hintsDisabled: z.boolean(),
  backNavigationAllowed: z.boolean(),
  currentQuestionIndex: z.number(),
  deadlineAt: z.string().nullable().optional(),
  reducedDistractionMode: z.boolean().optional(),
  hintScaffoldingEnabled: z.boolean().optional(),
  misconceptionDetectionEnabled: z.boolean().optional(),
  retakePolicy: z.string(),
  maxAttempts: z.number().nullable().optional(),
  remainingAttempts: z.number().nullable().optional(),
})

export const quizAttemptSummaryApiSchema = z.object({
  id: z.string(),
  attemptNumber: z.number(),
  submittedAt: z.string(),
  scorePercent: z.number().nullable().optional(),
  pointsEarned: z.number(),
  pointsPossible: z.number(),
})

export const quizAttemptsListPayloadSchema = z.object({
  attempts: z.array(quizAttemptSummaryApiSchema),
  policyScorePercent: z.number().nullable().optional(),
  retakePolicy: z.string(),
})

export const quizCurrentQuestionPayloadSchema = z.object({
  question: quizQuestionSchema.nullable(),
  questionIndex: z.number(),
  totalQuestions: z.number(),
  completed: z.boolean(),
})

export const quizAdvanceResponseSchema = z.object({
  locked: z.boolean(),
  currentQuestionIndex: z.number(),
  completed: z.boolean(),
})

export const quizHintRevealResponseSchema = z.object({
  level: z.number().nullable().optional(),
  body: z.string().nullable().optional(),
  mediaUrl: z.string().nullable().optional(),
  noMoreHints: z.boolean().optional(),
})

export const quizWorkedExampleStepSchema = z.object({
  number: z.number(),
  explanation: z.string(),
  expression: z.string().nullable().optional(),
})

export const quizWorkedExampleResponseSchema = z.object({
  title: z.string().nullable().optional(),
  body: z.string().nullable().optional(),
  steps: z.array(quizWorkedExampleStepSchema),
})

export const quizCodeRunResultSchema = z.object({
  status: z.enum(['pass', 'fail', 'tle', 'mle', 're', 'ce']),
  passed: z.boolean(),
  actualOutput: z.string(),
  expectedOutput: z.string(),
  stderr: z.string().nullable().optional(),
  executionMs: z.number().nullable().optional(),
  memoryKb: z.number().nullable().optional(),
})

export const quizCodeRunResponseSchema = z.object({
  questionId: z.string(),
  results: z.array(quizCodeRunResultSchema),
  pointsEarned: z.number(),
  pointsPossible: z.number(),
})

export const quizFocusLossEventRowSchema = z.object({
  id: z.string(),
  eventType: z.string(),
  durationMs: z.number().nullable().optional(),
  createdAt: z.string(),
})

export const quizFocusLossEventsResponseSchema = z.object({
  events: z.array(quizFocusLossEventRowSchema),
  total: z.number(),
})

export const quizSubmitResponseSchema = z.object({
  attemptId: z.string(),
  pointsEarned: z.number(),
  pointsPossible: z.number(),
  scorePercent: z.number(),
})

export const quizMisconceptionResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  remediationBody: z.string().nullable().optional(),
  remediationUrl: z.string().nullable().optional(),
  recurrenceCount: z.number(),
})

export const quizResultsQuestionResultSchema = z.object({
  questionIndex: z.number(),
  questionId: z.string().nullable().optional(),
  questionType: z.string(),
  promptSnapshot: z.string().nullable().optional(),
  responseJson: z.unknown(),
  isCorrect: z.boolean().nullable().optional(),
  pointsAwarded: z.number().nullable().optional(),
  maxPoints: z.number(),
  correctChoiceIndex: z.number().nullable().optional(),
  misconception: quizMisconceptionResultSchema.nullable().optional(),
})

export const quizResultsPayloadSchema = z.object({
  attemptId: z.string(),
  attemptNumber: z.number(),
  startedAt: z.string(),
  academicIntegrityFlag: z.boolean().optional(),
  extendedTimeActive: z.boolean().optional(),
  submittedAt: z.string().nullable().optional(),
  status: z.string(),
  isAdaptive: z.boolean(),
  score: z
    .object({
      pointsEarned: z.number(),
      pointsPossible: z.number(),
      scorePercent: z.number(),
    })
    .nullable()
    .optional(),
  questions: z.array(quizResultsQuestionResultSchema).nullable().optional(),
})

export const misconceptionRowSchema = z.object({
  id: z.string(),
  courseId: z.string(),
  conceptId: z.string().nullable().optional(),
  name: z.string(),
  description: z.string().nullable().optional(),
  remediationBody: z.string().nullable().optional(),
  remediationUrl: z.string().nullable().optional(),
  locale: z.string(),
  isSeed: z.boolean(),
})

export const importMisconceptionSeedLibraryResponseSchema = z.object({
  imported: z.number(),
  skipped: z.number(),
})

export const misconceptionReportRowSchema = z.object({
  misconceptionId: z.string(),
  misconceptionName: z.string(),
  questionId: z.string(),
  questionStem: z.string(),
  triggerCount: z.number(),
  affectedStudents: z.number(),
  firstSeenAt: z.string().nullable().optional(),
  lastSeenAt: z.string().nullable().optional(),
})

export const misconceptionReportResponseSchema = z.object({
  misconceptions: z.array(misconceptionReportRowSchema),
})

export const accommodationSummaryPayloadSchema = z.object({
  hasAccommodation: z.boolean(),
  flags: z.array(z.string()),
})

export const accommodationUserSearchHitSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string().nullable().optional(),
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
  sid: z.string().nullable().optional(),
})

export const accommodationUsersSearchResponseSchema = z.object({
  users: z.array(accommodationUserSearchHitSchema).optional(),
})

export const studentAccommodationRecordSchema = z.object({
  id: z.string(),
  userId: z.string(),
  courseId: z.string().nullable().optional(),
  courseCode: z.string().nullable().optional(),
  timeMultiplier: z.number(),
  extraAttempts: z.number(),
  hintsAlwaysEnabled: z.boolean(),
  reducedDistractionMode: z.boolean(),
  alternativeFormat: z.string().nullable().optional(),
  effectiveFrom: z.string().nullable().optional(),
  effectiveUntil: z.string().nullable().optional(),
  createdBy: z.string(),
  updatedBy: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const studentAccommodationRecordsListSchema = z.array(studentAccommodationRecordSchema)

export const contentPageMarkupSchema = z.object({
  id: z.string(),
  kind: z.enum(['highlight', 'note']),
  quoteText: z.string(),
  notebookPageId: z.string().nullable(),
  commentText: z.string().nullable(),
  createdAt: z.string(),
})

export const readerMarkupsListResponseSchema = z.object({
  markups: z.array(contentPageMarkupSchema).optional(),
})

export const syllabusSectionSchema = z.object({
  id: z.string(),
  heading: z.string(),
  markdown: z.string(),
})

export const courseSyllabusPayloadSchema = z.object({
  sections: z.array(syllabusSectionSchema),
  updatedAt: z.string(),
  requireSyllabusAcceptance: z.boolean(),
  syllabusAcceptancePending: z.boolean().optional(),
})

export const syllabusAcceptanceStatusSchema = z.object({
  requireSyllabusAcceptance: z.boolean(),
  hasAcceptedSyllabus: z.boolean(),
})

export const generatedSyllabusSectionMarkdownSchema = z.object({
  markdown: z.string(),
})

const courseOutcomeLinkProgressSchema = z.object({
  avgScorePercent: z.number().nullable(),
  gradedLearners: z.number(),
  enrolledLearners: z.number(),
})

export const courseOutcomeLinkSchema = z.object({
  id: z.string(),
  subOutcomeId: z.string().optional(),
  structureItemId: z.string(),
  targetKind: z.enum(['assignment', 'quiz', 'quiz_question']),
  quizQuestionId: z.string(),
  measurementLevel: z.string(),
  intensityLevel: z.string(),
  itemTitle: z.string(),
  itemKind: z.string(),
  progress: courseOutcomeLinkProgressSchema,
})

export const courseOutcomeSubOutcomeSchema = z.object({
  id: z.string(),
  outcomeId: z.string(),
  title: z.string(),
  description: z.string(),
  sortOrder: z.number(),
})

export const courseOutcomeSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  sortOrder: z.number(),
  rollupAvgScorePercent: z.number().nullable(),
  links: z.array(courseOutcomeLinkSchema),
})

export const courseOutcomesListResponseSchema = z.object({
  enrolledLearners: z.number(),
  outcomes: z.array(courseOutcomeSchema),
})

export const courseScopedAppRoleSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  scope: z.string(),
  createdAt: z.string(),
})

export const courseScopedRolesResponseSchema = z.object({
  roles: z.array(courseScopedAppRoleSchema).optional(),
})

export const courseExportBundleSchema = z.record(z.string(), z.unknown())

export const versionsListResponseSchema = z.object({
  versions: z.array(bankQuestionVersionSummarySchema),
})

export const restoreVersionResponseSchema = z.object({
  newVersionNumber: z.number().optional(),
})

export const standardCoverageItemSchema = z.object({
  standardCodeId: z.string(),
  code: z.string(),
  shortCode: z.string().nullable().optional(),
  description: z.string(),
  gradeBand: z.string().nullable().optional(),
  questionCount: z.number(),
  averageMastery: z.number().nullable().optional(),
  coverageStatus: z.string(),
  superseded: z.boolean(),
  supersededByStandardCodeId: z.string().nullable().optional(),
})

export const courseStandardsCoverageResponseSchema = z.object({
  standards: z.array(standardCoverageItemSchema),
})

export type StandardCoverageItem = z.infer<typeof standardCoverageItemSchema>
export type CourseStandardsCoveragePayload = z.infer<typeof courseStandardsCoverageResponseSchema>
