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
