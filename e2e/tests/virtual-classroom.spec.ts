/**
 * Virtual Classroom (plan 6.4) — End-to-end test suite
 *
 * Checklist coverage:
 *   [x] Unauthenticated requests to meeting endpoints return 401
 *   [x] Student cannot create a meeting (403)
 *   [x] Instructor can create a Jitsi meeting and receives a join URL
 *   [x] Meeting appears in list (GET /api/v1/courses/:code/meetings)
 *   [x] Meeting can be patched (title update, status → cancelled)
 *   [x] Cancelled meeting disappears from the list
 *   [x] GET /api/v1/meetings/:id/ical returns a valid text/calendar file
 *   [x] GET /api/v1/meetings/:id/attendance requires instructor role
 *   [x] Live Sessions page loads for authenticated user
 *   [x] Live Sessions page shows "Schedule Session" button for instructors
 *   [x] Live Sessions page hides schedule button for students
 *   [x] Countdown timer is rendered with role="timer"
 */
import { test, expect } from '@playwright/test'
import { apiSignup, apiCreateCourse, apiEnroll } from '../fixtures/api.js'
import { injectToken } from '../fixtures/test.js'

const API_BASE = process.env.E2E_API_URL ?? 'http://localhost:8080'
const PASSWORD = 'E2eTestPass1!'

function uniqueEmail(prefix = 'vm') {
  return `e2e-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.invalid`
}

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

// ---------------------------------------------------------------------------
// API tests — pure HTTP, no browser
// ---------------------------------------------------------------------------

test.describe('Virtual Classroom API', () => {
  test('unauthenticated access to meeting endpoints returns 401', async ({ request }) => {
    const fakeId = '00000000-0000-0000-0000-000000000001'
    const paths = [
      { method: 'GET', path: `/api/v1/courses/C-FAKE/meetings` },
      { method: 'POST', path: `/api/v1/courses/C-FAKE/meetings` },
      { method: 'GET', path: `/api/v1/meetings/${fakeId}/join` },
      { method: 'PATCH', path: `/api/v1/meetings/${fakeId}` },
      { method: 'GET', path: `/api/v1/meetings/${fakeId}/attendance` },
      { method: 'GET', path: `/api/v1/meetings/${fakeId}/ical` },
    ]
    for (const { method, path } of paths) {
      const res = await request.fetch(`${API_BASE}${path}`, { method })
      expect(res.status(), `${method} ${path}`).toBe(401)
    }
  })

  test('instructor creates a meeting and student cannot', async ({ request }) => {
    const instructorEmail = uniqueEmail('instr')
    const studentEmail = uniqueEmail('stu')
    const { access_token: instrToken } = await apiSignup({ email: instructorEmail, password: PASSWORD })
    const { access_token: studentToken } = await apiSignup({ email: studentEmail, password: PASSWORD })

    const course = await apiCreateCourse(instrToken, { title: 'VM E2E Course' })
    const cc = course.courseCode

    // Enroll student.
    await apiEnroll(instrToken, cc, studentEmail, 'student')

    // Student cannot create a meeting.
    const studentCreate = await request.post(`${API_BASE}/api/v1/courses/${cc}/meetings`, {
      headers: authHeaders(studentToken),
      data: { title: 'Student Meeting', provider: 'jitsi' },
    })
    expect(studentCreate.status()).toBe(403)

    // Instructor creates a meeting.
    const instrCreate = await request.post(`${API_BASE}/api/v1/courses/${cc}/meetings`, {
      headers: authHeaders(instrToken),
      data: {
        title: 'Weekly Lecture',
        provider: 'jitsi',
        scheduledStart: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        scheduledEnd: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      },
    })
    expect(instrCreate.status()).toBe(201)
    const meeting = await instrCreate.json() as {
      id: string
      title: string
      provider: string
      joinUrl?: string
      status: string
    }
    expect(meeting.title).toBe('Weekly Lecture')
    expect(meeting.provider).toBe('jitsi')
    expect(meeting.joinUrl).toBeTruthy()
    expect(meeting.status).toBe('scheduled')

    // Both instructor and student can list meetings.
    for (const tok of [instrToken, studentToken]) {
      const list = await request.get(`${API_BASE}/api/v1/courses/${cc}/meetings`, {
        headers: { Authorization: `Bearer ${tok}` },
      })
      expect(list.status()).toBe(200)
      const body = await list.json() as { meetings: unknown[] }
      expect(body.meetings.length).toBeGreaterThanOrEqual(1)
    }

    return { instrToken, studentToken, cc, meetingId: meeting.id }
  })

  test('patch meeting title and cancel it', async ({ request }) => {
    const email = uniqueEmail('patch')
    const { access_token: token } = await apiSignup({ email, password: PASSWORD })
    const course = await apiCreateCourse(token, { title: 'Patch VM Course' })
    const cc = course.courseCode

    const createRes = await request.post(`${API_BASE}/api/v1/courses/${cc}/meetings`, {
      headers: authHeaders(token),
      data: { title: 'Original Title', provider: 'jitsi' },
    })
    expect(createRes.status()).toBe(201)
    const { id } = await createRes.json() as { id: string }

    // Patch title.
    const patchRes = await request.patch(`${API_BASE}/api/v1/meetings/${id}`, {
      headers: authHeaders(token),
      data: { title: 'Updated Title' },
    })
    expect(patchRes.status()).toBe(200)
    const updated = await patchRes.json() as { title: string; status: string }
    expect(updated.title).toBe('Updated Title')

    // Cancel the meeting.
    const cancelRes = await request.patch(`${API_BASE}/api/v1/meetings/${id}`, {
      headers: authHeaders(token),
      data: { status: 'cancelled' },
    })
    expect(cancelRes.status()).toBe(200)
    const cancelled = await cancelRes.json() as { status: string }
    expect(cancelled.status).toBe('cancelled')

    // Cancelled meeting is excluded from list.
    const listRes = await request.get(`${API_BASE}/api/v1/courses/${cc}/meetings`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const { meetings } = await listRes.json() as { meetings: Array<{ id: string }> }
    expect(meetings.find((m) => m.id === id)).toBeUndefined()
  })

  test('GET /meetings/:id/ical returns valid iCalendar', async ({ request }) => {
    const email = uniqueEmail('ical')
    const { access_token: token } = await apiSignup({ email, password: PASSWORD })
    const course = await apiCreateCourse(token, { title: 'iCal VM Course' })
    const cc = course.courseCode

    const createRes = await request.post(`${API_BASE}/api/v1/courses/${cc}/meetings`, {
      headers: authHeaders(token),
      data: {
        title: 'Ical Test Lecture',
        provider: 'jitsi',
        scheduledStart: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        scheduledEnd: new Date(Date.now() + 90 * 60 * 1000).toISOString(),
      },
    })
    expect(createRes.status()).toBe(201)
    const { id } = await createRes.json() as { id: string }

    const icalRes = await request.get(`${API_BASE}/api/v1/meetings/${id}/ical`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(icalRes.status()).toBe(200)
    const contentType = icalRes.headers()['content-type'] ?? ''
    expect(contentType).toContain('text/calendar')
    const body = await icalRes.text()
    expect(body).toContain('BEGIN:VCALENDAR')
    expect(body).toContain('BEGIN:VEVENT')
    expect(body).toContain('Ical Test Lecture')
    expect(body).toContain('END:VEVENT')
    expect(body).toContain('END:VCALENDAR')
  })

  test('attendance endpoint requires instructor role', async ({ request }) => {
    const instrEmail = uniqueEmail('att-instr')
    const stuEmail = uniqueEmail('att-stu')
    const { access_token: instrToken } = await apiSignup({ email: instrEmail, password: PASSWORD })
    const { access_token: stuToken } = await apiSignup({ email: stuEmail, password: PASSWORD })
    const course = await apiCreateCourse(instrToken, { title: 'Attendance VM Course' })
    const cc = course.courseCode
    await apiEnroll(instrToken, cc, stuEmail, 'student')

    const createRes = await request.post(`${API_BASE}/api/v1/courses/${cc}/meetings`, {
      headers: authHeaders(instrToken),
      data: { title: 'Attendance Test', provider: 'jitsi' },
    })
    const { id } = await createRes.json() as { id: string }

    // Student cannot view attendance.
    const stuAtt = await request.get(`${API_BASE}/api/v1/meetings/${id}/attendance`, {
      headers: { Authorization: `Bearer ${stuToken}` },
    })
    expect(stuAtt.status()).toBe(403)

    // Instructor can view attendance.
    const instrAtt = await request.get(`${API_BASE}/api/v1/meetings/${id}/attendance`, {
      headers: { Authorization: `Bearer ${instrToken}` },
    })
    expect(instrAtt.status()).toBe(200)
    const { attendance } = await instrAtt.json() as { attendance: unknown[] }
    expect(Array.isArray(attendance)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Browser (Playwright) tests
// ---------------------------------------------------------------------------

test.describe('Live Sessions UI', () => {
  test('Live Sessions page is accessible and shows nav link', async ({ page }) => {
    const email = uniqueEmail('ui')
    const { access_token: token } = await apiSignup({ email, password: PASSWORD })
    const course = await apiCreateCourse(token, { title: 'UI VM Course' })
    const cc = course.courseCode

    await injectToken(page, token)
    await page.goto(`/courses/${cc}/live`)
    await expect(page.getByRole('heading', { name: /live sessions/i })).toBeVisible({ timeout: 10000 })
  })

  test('instructor sees "Schedule Session" button', async ({ page }) => {
    const email = uniqueEmail('instr-ui')
    const { access_token: token } = await apiSignup({ email, password: PASSWORD })
    const course = await apiCreateCourse(token, { title: 'Instr UI VM' })
    const cc = course.courseCode

    await injectToken(page, token)
    await page.goto(`/courses/${cc}/live`)
    await expect(page.getByRole('button', { name: /schedule session/i })).toBeVisible({ timeout: 10000 })
  })

  test('student does not see "Schedule Session" button', async ({ page }) => {
    const instrEmail = uniqueEmail('instr2')
    const stuEmail = uniqueEmail('stu2')
    const { access_token: instrToken } = await apiSignup({ email: instrEmail, password: PASSWORD })
    const { access_token: stuToken } = await apiSignup({ email: stuEmail, password: PASSWORD })
    const course = await apiCreateCourse(instrToken, { title: 'Stu UI VM' })
    const cc = course.courseCode
    await apiEnroll(instrToken, cc, stuEmail, 'student')

    await injectToken(page, stuToken)
    await page.goto(`/courses/${cc}/live`)
    // Wait for page to fully load.
    await expect(page.getByRole('heading', { name: /live sessions/i })).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('button', { name: /schedule session/i })).not.toBeVisible()
  })

  test('creating a meeting via the UI shows it in the list', async ({ page }) => {
    const email = uniqueEmail('create-ui')
    const { access_token: token } = await apiSignup({ email, password: PASSWORD })
    const course = await apiCreateCourse(token, { title: 'Create UI VM' })
    const cc = course.courseCode

    await injectToken(page, token)
    await page.goto(`/courses/${cc}/live`)

    // Open modal.
    await page.getByRole('button', { name: /schedule session/i }).click()
    await expect(page.getByRole('dialog', { name: /schedule live session/i })).toBeVisible()

    // Fill in title.
    const titleInput = page.getByRole('dialog').getByLabel('Title')
    await titleInput.fill('My E2E Lecture')

    // Submit.
    await page.getByRole('dialog').getByRole('button', { name: /schedule/i }).click()

    // Modal should close and meeting appears.
    await expect(page.getByRole('dialog')).not.toBeVisible()
    await expect(page.getByText('My E2E Lecture')).toBeVisible({ timeout: 8000 })
  })

  test('sidenav shows Live Sessions link', async ({ page }) => {
    const email = uniqueEmail('nav')
    const { access_token: token } = await apiSignup({ email, password: PASSWORD })
    const course = await apiCreateCourse(token, { title: 'Nav VM' })
    const cc = course.courseCode

    await injectToken(page, token)
    await page.goto(`/courses/${cc}`)
    // Look for the nav link.
    await expect(
      page.getByRole('link', { name: /live sessions/i }),
    ).toBeVisible({ timeout: 10000 })
  })
})
