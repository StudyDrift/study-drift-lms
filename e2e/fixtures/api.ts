/**
 * Lightweight API helpers for seeding and inspecting state during e2e tests.
 * All requests go directly to the API (bypassing the browser) for speed.
 */

const apiBase = process.env.E2E_API_URL ?? 'http://localhost:8080'

export interface UserCredentials {
  email: string
  password: string
  displayName?: string
}

export interface AuthTokens {
  access_token: string
}

export async function apiSignup(creds: UserCredentials): Promise<AuthTokens> {
  const res = await fetch(`${apiBase}/api/v1/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: creds.email,
      password: creds.password,
      display_name: creds.displayName,
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Signup failed (${res.status}): ${body}`)
  }
  return res.json() as Promise<AuthTokens>
}

export async function apiLogin(creds: UserCredentials): Promise<AuthTokens> {
  const res = await fetch(`${apiBase}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: creds.email, password: creds.password }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Login failed (${res.status}): ${body}`)
  }
  return res.json() as Promise<AuthTokens>
}

export async function apiGetCourse(
  token: string,
  courseCode: string,
): Promise<Record<string, unknown>> {
  const res = await fetch(
    `${apiBase}/api/v1/courses/${encodeURIComponent(courseCode)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Get course failed (${res.status}): ${body}`)
  }
  return res.json() as Promise<Record<string, unknown>>
}

export async function apiCreateCourse(
  token: string,
  payload: { title: string; description?: string },
): Promise<{ courseCode: string; id: string; title: string }> {
  const res = await fetch(`${apiBase}/api/v1/courses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Create course failed (${res.status}): ${body}`)
  }
  return res.json() as Promise<{ courseCode: string; id: string; title: string }>
}

export async function apiCreateContentPage(
  token: string,
  courseCode: string,
  moduleId: string,
  title: string,
): Promise<{ id: string; title: string }> {
  const res = await fetch(
    `${apiBase}/api/v1/courses/${encodeURIComponent(courseCode)}/structure/modules/${encodeURIComponent(moduleId)}/content-pages`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ title }),
    },
  )
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Create content page failed (${res.status}): ${body}`)
  }
  return res.json() as Promise<{ id: string; title: string }>
}

export async function apiCreateModule(
  token: string,
  courseCode: string,
  title: string,
): Promise<{ id: string; title: string }> {
  const res = await fetch(
    `${apiBase}/api/v1/courses/${encodeURIComponent(courseCode)}/structure/modules`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ title }),
    },
  )
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Create module failed (${res.status}): ${body}`)
  }
  return res.json() as Promise<{ id: string; title: string }>
}

export async function apiEnroll(
  token: string,
  courseCode: string,
  emails: string,
  courseRole = 'student',
): Promise<void> {
  const res = await fetch(
    `${apiBase}/api/v1/courses/${encodeURIComponent(courseCode)}/enrollments`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ emails, courseRole }),
    },
  )
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Enroll failed (${res.status}): ${body}`)
  }
}

export async function apiGetFeedChannels(
  token: string,
  courseCode: string,
): Promise<Array<{ id: string; name: string }>> {
  const res = await fetch(
    `${apiBase}/api/v1/courses/${encodeURIComponent(courseCode)}/feed/channels`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Get feed channels failed (${res.status}): ${body}`)
  }
  return res.json() as Promise<Array<{ id: string; name: string }>>
}

export async function apiCreateFeedChannel(
  token: string,
  courseCode: string,
  name: string,
): Promise<{ id: string; name: string }> {
  const res = await fetch(
    `${apiBase}/api/v1/courses/${encodeURIComponent(courseCode)}/feed/channels`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name }),
    },
  )
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Create feed channel failed (${res.status}): ${body}`)
  }
  return res.json() as Promise<{ id: string; name: string }>
}

export async function apiPostFeedMessage(
  token: string,
  courseCode: string,
  channelId: string,
  body: string,
): Promise<{ id: string }> {
  const res = await fetch(
    `${apiBase}/api/v1/courses/${encodeURIComponent(courseCode)}/feed/channels/${encodeURIComponent(channelId)}/messages`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ body, mentionUserIds: [], mentionsEveryone: false }),
    },
  )
  if (!res.ok) {
    const body2 = await res.text()
    throw new Error(`Post feed message failed (${res.status}): ${body2}`)
  }
  return res.json() as Promise<{ id: string }>
}

export async function apiCreateForum(
  token: string,
  courseCode: string,
  name: string,
): Promise<{ id: string; name: string }> {
  const res = await fetch(
    `${apiBase}/api/v1/courses/${encodeURIComponent(courseCode)}/forums`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name, description: '' }),
    },
  )
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Create forum failed (${res.status}): ${body}`)
  }
  return res.json() as Promise<{ id: string; name: string }>
}

export async function apiCreateDiscussionThread(
  token: string,
  courseCode: string,
  forumId: string,
  title: string,
): Promise<{ id: string; title: string }> {
  const res = await fetch(
    `${apiBase}/api/v1/courses/${encodeURIComponent(courseCode)}/forums/${encodeURIComponent(forumId)}/threads`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        title,
        // body is json.RawMessage on the server — send a raw TipTap doc object, not a string.
        body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Thread body.' }] }] },
        requirePostFirst: false,
      }),
    },
  )
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Create discussion thread failed (${res.status}): ${body}`)
  }
  return res.json() as Promise<{ id: string; title: string }>
}

export async function apiEnableCourseFeatures(
  token: string,
  courseCode: string,
  features: {
    discussionsEnabled?: boolean
    feedEnabled?: boolean
    notebookEnabled?: boolean
    calendarEnabled?: boolean
    questionBankEnabled?: boolean
  } = {},
): Promise<void> {
  const res = await fetch(
    `${apiBase}/api/v1/courses/${encodeURIComponent(courseCode)}/features`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      // Only bool (non-pointer) fields need explicit values; others default to false.
      body: JSON.stringify({
        feedEnabled: features.feedEnabled ?? false,
        calendarEnabled: features.calendarEnabled ?? true,
        questionBankEnabled: features.questionBankEnabled ?? true,
        discussionsEnabled: features.discussionsEnabled ?? false,
        lockdownModeEnabled: false,
      }),
    },
  )
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Enable course features failed (${res.status}): ${body}`)
  }
}

export async function apiGetSettingsAccount(
  token: string,
): Promise<{ displayName: string | null; email: string }> {
  const res = await fetch(`${apiBase}/api/v1/settings/account`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`Get settings failed (${res.status})`)
  return res.json() as Promise<{ displayName: string | null; email: string }>
}

export async function apiCreateAssignment(
  token: string,
  courseCode: string,
  moduleId: string,
  title: string,
): Promise<{ id: string; title: string }> {
  const res = await fetch(
    `${apiBase}/api/v1/courses/${encodeURIComponent(courseCode)}/structure/modules/${encodeURIComponent(moduleId)}/assignments`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ title }),
    },
  )
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Create assignment failed (${res.status}): ${body}`)
  }
  return res.json() as Promise<{ id: string; title: string }>
}

export async function apiPatchAssignment(
  token: string,
  courseCode: string,
  assignmentId: string,
  patch: {
    pointsWorth?: number
    postingPolicy?: 'automatic' | 'manual'
  },
): Promise<void> {
  const res = await fetch(
    `${apiBase}/api/v1/courses/${encodeURIComponent(courseCode)}/assignments/${encodeURIComponent(assignmentId)}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(patch),
    },
  )
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Patch assignment failed (${res.status}): ${body}`)
  }
}

export async function apiListEnrollments(
  token: string,
  courseCode: string,
): Promise<Array<{ userId: string; role: string }>> {
  const res = await fetch(
    `${apiBase}/api/v1/courses/${encodeURIComponent(courseCode)}/enrollments`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`List enrollments failed (${res.status}): ${body}`)
  }
  const raw = (await res.json()) as { enrollments: Array<{ userId: string; role: string }> }
  return raw.enrollments
}

export async function apiPutGradingScheme(
  token: string,
  courseCode: string,
  body: { type: string; scaleJson?: unknown; name?: string },
): Promise<{ scheme: { type: string; scaleJson: unknown } | null }> {
  const res = await fetch(
    `${apiBase}/api/v1/courses/${encodeURIComponent(courseCode)}/grading-scheme`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    },
  )
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Put grading scheme failed (${res.status}): ${text}`)
  }
  return res.json() as Promise<{ scheme: { type: string; scaleJson: unknown } | null }>
}

export async function apiGetGradingScheme(
  token: string,
  courseCode: string,
): Promise<{ scheme: { type: string; scaleJson: unknown } | null }> {
  const res = await fetch(
    `${apiBase}/api/v1/courses/${encodeURIComponent(courseCode)}/grading-scheme`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Get grading scheme failed (${res.status}): ${body}`)
  }
  return res.json() as Promise<{ scheme: { type: string; scaleJson: unknown } | null }>
}

export async function apiGetCourseGrading(
  token: string,
  courseCode: string,
): Promise<{ gradingScale: string; sbgEnabled?: boolean }> {
  const res = await fetch(
    `${apiBase}/api/v1/courses/${encodeURIComponent(courseCode)}/grading`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Get course grading failed (${res.status}): ${body}`)
  }
  return res.json() as Promise<{ gradingScale: string; sbgEnabled?: boolean }>
}

export async function apiPutCourseGrading(
  token: string,
  courseCode: string,
  body: {
    gradingScale: string
    assignmentGroups: {
      id?: string
      name: string
      sortOrder: number
      weightPercent: number
      dropLowest?: number
      dropHighest?: number
      replaceLowestWithFinal?: boolean
    }[]
    sbgEnabled?: boolean
    sbgProficiencyScaleJson?: unknown
    sbgAggregationRule?: string
  },
): Promise<void> {
  const res = await fetch(`${apiBase}/api/v1/courses/${encodeURIComponent(courseCode)}/grading`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`Put course grading failed (${res.status}): ${txt}`)
  }
}

/** Default letter bands mirrored from web grading settings. */
export const E2E_DEFAULT_LETTER_SCALE = [
  { label: 'A', min_pct: 90, gpa: 4 },
  { label: 'B', min_pct: 80, gpa: 3 },
  { label: 'C', min_pct: 70, gpa: 2 },
  { label: 'D', min_pct: 60, gpa: 1 },
  { label: 'F', min_pct: 0, gpa: 0 },
]

export async function apiPutGradebookGrades(
  token: string,
  courseCode: string,
  grades: Record<string, Record<string, string>>,
): Promise<void> {
  const res = await fetch(
    `${apiBase}/api/v1/courses/${encodeURIComponent(courseCode)}/gradebook/grades`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ grades }),
    },
  )
  if (res.ok) return
  const body = await res.text()
  throw new Error(`Put gradebook grades failed (${res.status}): ${body}`)
}

/** GET `/outcomes` — matches server `CourseOutcomesListResponse`. */
export interface ApiCourseOutcomeLink {
  id: string
  structureItemId: string
  targetKind: string
  itemTitle: string
  measurementLevel: string
  intensityLevel: string
}

export interface ApiCourseOutcome {
  id: string
  title: string
  description: string
  links: ApiCourseOutcomeLink[]
}

export async function apiPatchCourseFeatures(
  token: string,
  courseCode: string,
  features: {
    notebookEnabled?: boolean
    feedEnabled?: boolean
    calendarEnabled?: boolean
    questionBankEnabled?: boolean
    lockdownModeEnabled?: boolean
    discussionsEnabled?: boolean
    sectionsEnabled?: boolean
  },
): Promise<Record<string, unknown>> {
  const res = await fetch(
    `${apiBase}/api/v1/courses/${encodeURIComponent(courseCode)}/features`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        notebookEnabled: features.notebookEnabled ?? true,
        feedEnabled: features.feedEnabled ?? false,
        calendarEnabled: features.calendarEnabled ?? true,
        questionBankEnabled: features.questionBankEnabled ?? false,
        lockdownModeEnabled: features.lockdownModeEnabled ?? false,
        discussionsEnabled: features.discussionsEnabled ?? false,
        sectionsEnabled: features.sectionsEnabled,
      }),
    },
  )
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Patch course features failed (${res.status}): ${body}`)
  }
  return res.json() as Promise<Record<string, unknown>>
}

export async function apiArchiveCourseStructureItem(
  token: string,
  courseCode: string,
  itemId: string,
): Promise<void> {
  const res = await fetch(
    `${apiBase}/api/v1/courses/${encodeURIComponent(courseCode)}/structure/items/${encodeURIComponent(itemId)}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ archived: true }),
    },
  )
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Archive structure item failed (${res.status}): ${body}`)
  }
}

export async function apiGetCourseSections(
  token: string,
  courseCode: string,
): Promise<Array<{ id: string; sectionCode: string; status: string; name?: string }>> {
  const res = await fetch(
    `${apiBase}/api/v1/courses/${encodeURIComponent(courseCode)}/sections`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Get course sections failed (${res.status}): ${body}`)
  }
  const raw = (await res.json()) as { sections: Array<{ id: string; sectionCode: string; status: string; name?: string }> }
  return raw.sections
}

export async function apiGetCourseOutcomes(
  token: string,
  courseCode: string,
): Promise<{ enrolledLearners: number; outcomes: ApiCourseOutcome[] }> {
  const res = await fetch(`${apiBase}/api/v1/courses/${encodeURIComponent(courseCode)}/outcomes`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Get outcomes failed (${res.status}): ${body}`)
  }
  return res.json() as Promise<{ enrolledLearners: number; outcomes: ApiCourseOutcome[] }>
}

// ---------------------------------------------------------------------------
// Collaborative documents
// ---------------------------------------------------------------------------

export interface CollabDocApi {
  id: string
  title: string
  docType: 'rich_text' | 'whiteboard'
  updatedAt: string
}

export async function apiListCollabDocs(
  token: string,
  courseCode: string,
): Promise<CollabDocApi[]> {
  const res = await fetch(
    `${apiBase}/api/v1/courses/${encodeURIComponent(courseCode)}/collab-docs`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`List collab docs failed (${res.status}): ${body}`)
  }
  const raw = (await res.json()) as { docs: CollabDocApi[] }
  return raw.docs
}

export async function apiCreateCollabDoc(
  token: string,
  courseCode: string,
  title: string,
  docType: 'rich_text' | 'whiteboard' = 'rich_text',
): Promise<CollabDocApi> {
  const res = await fetch(
    `${apiBase}/api/v1/courses/${encodeURIComponent(courseCode)}/collab-docs`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ title, docType }),
    },
  )
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Create collab doc failed (${res.status}): ${body}`)
  }
  return res.json() as Promise<CollabDocApi>
}

export async function apiDeleteCollabDoc(
  token: string,
  courseCode: string,
  docId: string,
): Promise<void> {
  const res = await fetch(
    `${apiBase}/api/v1/courses/${encodeURIComponent(courseCode)}/collab-docs/${encodeURIComponent(docId)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    },
  )
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Delete collab doc failed (${res.status}): ${body}`)
  }
}

export async function apiEnableCollabDocs(
  token: string,
  courseCode: string,
): Promise<void> {
  const res = await fetch(
    `${apiBase}/api/v1/courses/${encodeURIComponent(courseCode)}/features`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ collabDocsEnabled: true }),
    },
  )
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Enable collab docs failed (${res.status}): ${body}`)
  }
}

// ---------------------------------------------------------------------------
// Group Spaces helpers (plan 6.6)
// ---------------------------------------------------------------------------

export async function apiEnableGroupSpaces(
  token: string,
  courseCode: string,
): Promise<void> {
  const res = await fetch(
    `${apiBase}/api/v1/courses/${encodeURIComponent(courseCode)}/features`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ groupSpacesEnabled: true }),
    },
  )
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Enable group spaces failed (${res.status}): ${body}`)
  }
}

export interface GroupApi {
  id: string
  groupSetId: string
  name: string
  sortOrder: number
  createdAt: string
  memberCount: number
}

export async function apiGetMyGroups(
  token: string,
  courseCode: string,
): Promise<GroupApi[]> {
  const res = await fetch(
    `${apiBase}/api/v1/courses/${encodeURIComponent(courseCode)}/my-groups`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Get my groups failed (${res.status}): ${body}`)
  }
  const raw = (await res.json()) as { groups: GroupApi[] }
  return raw.groups ?? []
}

export async function apiGetAllGroups(
  token: string,
  courseCode: string,
): Promise<GroupApi[]> {
  const res = await fetch(
    `${apiBase}/api/v1/courses/${encodeURIComponent(courseCode)}/groups`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Get all groups failed (${res.status}): ${body}`)
  }
  const raw = (await res.json()) as { groups: GroupApi[] }
  return raw.groups ?? []
}

export async function apiGetGroupChannels(
  token: string,
  courseCode: string,
  groupId: string,
): Promise<Array<{ id: string; name: string }>> {
  const res = await fetch(
    `${apiBase}/api/v1/courses/${encodeURIComponent(courseCode)}/groups/${encodeURIComponent(groupId)}/feed/channels`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Get group channels failed (${res.status}): ${body}`)
  }
  const raw = (await res.json()) as { channels: Array<{ id: string; name: string }> }
  return raw.channels ?? []
}

export async function apiCreateGroupChannel(
  token: string,
  courseCode: string,
  groupId: string,
  name: string,
): Promise<{ id: string; name: string }> {
  const res = await fetch(
    `${apiBase}/api/v1/courses/${encodeURIComponent(courseCode)}/groups/${encodeURIComponent(groupId)}/feed/channels`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name }),
    },
  )
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Create group channel failed (${res.status}): ${body}`)
  }
  return res.json() as Promise<{ id: string; name: string }>
}

export async function apiPostGroupMessage(
  token: string,
  courseCode: string,
  groupId: string,
  channelId: string,
  body: string,
): Promise<{ id: string }> {
  const res = await fetch(
    `${apiBase}/api/v1/courses/${encodeURIComponent(courseCode)}/groups/${encodeURIComponent(groupId)}/feed/channels/${encodeURIComponent(channelId)}/messages`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ body, mentionUserIds: [], mentionsEveryone: false }),
    },
  )
  if (!res.ok) {
    const body2 = await res.text()
    throw new Error(`Post group message failed (${res.status}): ${body2}`)
  }
  return res.json() as Promise<{ id: string }>
}

// ---------------------------------------------------------------------------
// Help widget helpers (plan 6.8)
// ---------------------------------------------------------------------------

export interface HelpArticle {
  title: string
  url: string
  slug: string
}

export async function apiGetContextualArticles(
  token: string,
  route: string,
): Promise<HelpArticle[]> {
  const res = await fetch(
    `${apiBase}/api/v1/help/contextual-articles?route=${encodeURIComponent(route)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Get contextual articles failed (${res.status}): ${body}`)
  }
  const data = (await res.json()) as { articles: HelpArticle[] }
  return data.articles ?? []
}

export interface SupportWidgetConfig {
  orgId: string
  enabled: boolean
  provider: string
  websiteId: string | null
  dpaConfirmedAt: string | null
}

export async function apiGetSupportWidgetConfig(
  token: string,
  orgId: string,
): Promise<SupportWidgetConfig> {
  const res = await fetch(
    `${apiBase}/api/v1/orgs/${encodeURIComponent(orgId)}/settings/support-widget`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Get support widget config failed (${res.status}): ${body}`)
  }
  return res.json() as Promise<SupportWidgetConfig>
}

export async function apiPutSupportWidgetConfig(
  token: string,
  orgId: string,
  config: { enabled?: boolean; provider?: string; websiteId?: string; dpaConfirm?: boolean },
): Promise<SupportWidgetConfig> {
  const res = await fetch(
    `${apiBase}/api/v1/orgs/${encodeURIComponent(orgId)}/settings/support-widget`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(config),
    },
  )
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Put support widget config failed (${res.status}): ${body}`)
  }
  return res.json() as Promise<SupportWidgetConfig>
}
