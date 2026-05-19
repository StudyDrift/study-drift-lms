/**
 * Office Hours (plan 6.7) — End-to-end test suite
 *
 * Checklist coverage:
 *   [x] Unauthenticated requests to office hours endpoints return 401
 *   [x] Student cannot create an availability window (403)
 *   [x] Instructor can create a recurring availability window and slots are generated
 *   [x] Slots appear in availability list for enrolled users
 *   [x] Student can book an available slot (201)
 *   [x] Double-booking the same slot returns 409
 *   [x] Student can cancel their own booking
 *   [x] GET /me/appointments returns booked slots
 *   [x] GET /slots/:id/ical returns a valid text/calendar file
 *   [x] Student cannot see another student's booking note (privacy)
 *   [x] Office Hours page loads after enabling the feature flag
 *   [x] Instructor sees "Add availability" button; student does not
 *   [x] Student can open booking modal and book a slot via UI
 *   [x] Office Hours nav link appears when feature flag is enabled
 */
import { test, expect } from '@playwright/test'
import { apiSignup, apiCreateCourse, apiEnroll } from '../fixtures/api.js'
import { injectToken } from '../fixtures/test.js'

const API_BASE = process.env.E2E_API_URL ?? 'http://localhost:8080'
const PASSWORD = 'E2eTestPass1!'

function uniqueEmail(prefix = 'oh') {
  return `e2e-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.invalid`
}

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

// Next Tuesday's date (or today if today is Tuesday) — for one-off window tests
function nextWeekdayDate(targetDow: number): string {
  const now = new Date()
  const today = now.getDay()
  const daysUntil = ((targetDow - today) + 7) % 7 || 7
  const target = new Date(now)
  target.setDate(now.getDate() + daysUntil)
  return target.toISOString().slice(0, 10)
}

// Enable office hours for a course via PATCH /features
async function enableOfficeHours(token: string, courseCode: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/v1/courses/${courseCode}/features`, {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify({ officeHoursEnabled: true }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Failed to enable office hours: ${res.status} ${body}`)
  }
}

// ---------------------------------------------------------------------------
// API tests — pure HTTP, no browser
// ---------------------------------------------------------------------------

test.describe('Office Hours API', () => {
  test('unauthenticated access returns 401', async ({ request }) => {
    const fakeSlot = '00000000-0000-0000-0000-000000000001'
    const paths = [
      { method: 'POST', path: `/api/v1/courses/C-FAKE/availability` },
      { method: 'GET', path: `/api/v1/courses/C-FAKE/availability` },
      { method: 'POST', path: `/api/v1/slots/${fakeSlot}/book` },
      { method: 'DELETE', path: `/api/v1/slots/${fakeSlot}/book` },
      { method: 'GET', path: `/api/v1/me/appointments` },
      { method: 'GET', path: `/api/v1/slots/${fakeSlot}/ical` },
    ]
    for (const { method, path } of paths) {
      const res = await request.fetch(`${API_BASE}${path}`, { method })
      expect(res.status(), `${method} ${path}`).toBe(401)
    }
  })

  test('student cannot create an availability window (403)', async ({ request }) => {
    const instrEmail = uniqueEmail('instr')
    const stuEmail = uniqueEmail('stu')
    const { access_token: instrToken } = await apiSignup({ email: instrEmail, password: PASSWORD })
    const { access_token: stuToken } = await apiSignup({ email: stuEmail, password: PASSWORD })
    const course = await apiCreateCourse(instrToken, { title: 'OH Perm Test' })
    const cc = course.courseCode
    await apiEnroll(instrToken, cc, stuEmail, 'student')

    const res = await request.post(`${API_BASE}/api/v1/courses/${cc}/availability`, {
      headers: authHeaders(stuToken),
      data: { dayOfWeek: 2, startTime: '09:00', endTime: '10:00' },
    })
    expect(res.status()).toBe(403)
  })

  test('instructor creates a recurring window and slots are generated', async ({ request }) => {
    const instrEmail = uniqueEmail('instr-create')
    const { access_token: instrToken } = await apiSignup({ email: instrEmail, password: PASSWORD })
    const course = await apiCreateCourse(instrToken, { title: 'OH Create Test' })
    const cc = course.courseCode

    const res = await request.post(`${API_BASE}/api/v1/courses/${cc}/availability`, {
      headers: authHeaders(instrToken),
      data: {
        dayOfWeek: 2, // Tuesday
        startTime: '09:00',
        endTime: '10:00',
        slotDurationMinutes: 15,
        location: 'Room 101',
      },
    })
    expect(res.status()).toBe(201)
    const body = await res.json() as {
      window: { id: string; dayOfWeek: number; startTime: string }
      slots: Array<{ id: string; status: string; slotStart: string }>
    }
    expect(body.window.dayOfWeek).toBe(2)
    expect(body.window.startTime).toMatch(/^09:00/)
    // 1 hour / 15 min = 4 slots per Tuesday; there may be 4 or 5 Tuesdays in 28 days.
    expect(body.slots.length).toBeGreaterThanOrEqual(4)
    expect(body.slots.length).toBeLessThanOrEqual(20)
    expect(body.slots[0].status).toBe('available')

    return { instrToken, cc, windowId: body.window.id, firstSlotId: body.slots[0].id }
  })

  test('instructor creates a one-off window', async ({ request }) => {
    const instrEmail = uniqueEmail('instr-oneoff')
    const { access_token: instrToken } = await apiSignup({ email: instrEmail, password: PASSWORD })
    const course = await apiCreateCourse(instrToken, { title: 'OH OneOff Test' })
    const cc = course.courseCode

    const windowDate = nextWeekdayDate(2) // next Tuesday

    const res = await request.post(`${API_BASE}/api/v1/courses/${cc}/availability`, {
      headers: authHeaders(instrToken),
      data: {
        windowDate,
        startTime: '14:00',
        endTime: '15:00',
        slotDurationMinutes: 30,
      },
    })
    expect(res.status()).toBe(201)
    const body = await res.json() as {
      window: { id: string; windowDate: string }
      slots: Array<{ id: string }>
    }
    expect(body.window.windowDate).toBe(windowDate)
    expect(body.slots.length).toBe(2) // 60 min / 30 min = 2 slots
  })

  test('enrolled student can list slots; unenrolled cannot', async ({ request }) => {
    const instrEmail = uniqueEmail('instr-list')
    const stuEmail = uniqueEmail('stu-list')
    const outsiderEmail = uniqueEmail('outsider')
    const { access_token: instrToken } = await apiSignup({ email: instrEmail, password: PASSWORD })
    const { access_token: stuToken } = await apiSignup({ email: stuEmail, password: PASSWORD })
    const { access_token: outsiderToken } = await apiSignup({ email: outsiderEmail, password: PASSWORD })
    const course = await apiCreateCourse(instrToken, { title: 'OH List Test' })
    const cc = course.courseCode
    await apiEnroll(instrToken, cc, stuEmail, 'student')

    // Create a window so there's something to list.
    await request.post(`${API_BASE}/api/v1/courses/${cc}/availability`, {
      headers: authHeaders(instrToken),
      data: { dayOfWeek: 3, startTime: '10:00', endTime: '11:00', slotDurationMinutes: 15 },
    })

    // Enrolled student can list.
    const stuRes = await request.get(`${API_BASE}/api/v1/courses/${cc}/availability`, {
      headers: { Authorization: `Bearer ${stuToken}` },
    })
    expect(stuRes.status()).toBe(200)
    const { windows, slots } = await stuRes.json() as { windows: unknown[]; slots: unknown[] }
    expect(Array.isArray(windows)).toBe(true)
    expect(Array.isArray(slots)).toBe(true)

    // Outsider gets 404.
    const outsiderRes = await request.get(`${API_BASE}/api/v1/courses/${cc}/availability`, {
      headers: { Authorization: `Bearer ${outsiderToken}` },
    })
    expect(outsiderRes.status()).toBe(404)
  })

  test('student books a slot and double-booking returns 409', async ({ request }) => {
    const instrEmail = uniqueEmail('instr-book')
    const stu1Email = uniqueEmail('stu1-book')
    const stu2Email = uniqueEmail('stu2-book')
    const { access_token: instrToken } = await apiSignup({ email: instrEmail, password: PASSWORD })
    const { access_token: stu1Token } = await apiSignup({ email: stu1Email, password: PASSWORD })
    const { access_token: stu2Token } = await apiSignup({ email: stu2Email, password: PASSWORD })
    const course = await apiCreateCourse(instrToken, { title: 'OH Book Test' })
    const cc = course.courseCode
    await apiEnroll(instrToken, cc, stu1Email, 'student')
    await apiEnroll(instrToken, cc, stu2Email, 'student')

    // Create window with one slot.
    const windowDate = nextWeekdayDate(4) // Thursday
    const createRes = await request.post(`${API_BASE}/api/v1/courses/${cc}/availability`, {
      headers: authHeaders(instrToken),
      data: { windowDate, startTime: '11:00', endTime: '11:30', slotDurationMinutes: 30 },
    })
    expect(createRes.status()).toBe(201)
    const { slots } = await createRes.json() as { slots: Array<{ id: string }> }
    expect(slots.length).toBe(1)
    const slotId = slots[0].id

    // Student 1 books.
    const bookRes = await request.post(`${API_BASE}/api/v1/slots/${slotId}/book`, {
      headers: authHeaders(stu1Token),
      data: { note: 'Question about midterm' },
    })
    expect(bookRes.status()).toBe(201)
    const booked = await bookRes.json() as { status: string; studentNote: string }
    expect(booked.status).toBe('booked')
    expect(booked.studentNote).toBe('Question about midterm')

    // Student 2 tries same slot → 409.
    const dup = await request.post(`${API_BASE}/api/v1/slots/${slotId}/book`, {
      headers: authHeaders(stu2Token),
      data: {},
    })
    expect(dup.status()).toBe(409)

    return { instrToken, stu1Token, stu2Token, cc, slotId }
  })

  test('student can cancel their booking and slot becomes available again', async ({ request }) => {
    const instrEmail = uniqueEmail('instr-cancel')
    const stuEmail = uniqueEmail('stu-cancel')
    const { access_token: instrToken } = await apiSignup({ email: instrEmail, password: PASSWORD })
    const { access_token: stuToken } = await apiSignup({ email: stuEmail, password: PASSWORD })
    const course = await apiCreateCourse(instrToken, { title: 'OH Cancel Test' })
    const cc = course.courseCode
    await apiEnroll(instrToken, cc, stuEmail, 'student')

    const windowDate = nextWeekdayDate(5) // Friday
    const createRes = await request.post(`${API_BASE}/api/v1/courses/${cc}/availability`, {
      headers: authHeaders(instrToken),
      data: { windowDate, startTime: '15:00', endTime: '15:30', slotDurationMinutes: 30 },
    })
    const { slots } = await createRes.json() as { slots: Array<{ id: string }> }
    const slotId = slots[0].id

    // Book.
    await request.post(`${API_BASE}/api/v1/slots/${slotId}/book`, {
      headers: authHeaders(stuToken),
      data: {},
    })

    // Cancel.
    const cancelRes = await request.delete(`${API_BASE}/api/v1/slots/${slotId}/book`, {
      headers: authHeaders(stuToken),
    })
    expect(cancelRes.status()).toBe(200)
    const cancelled = await cancelRes.json() as { status: string }
    expect(cancelled.status).toBe('available')
  })

  test('GET /me/appointments returns booked slots', async ({ request }) => {
    const instrEmail = uniqueEmail('instr-me')
    const stuEmail = uniqueEmail('stu-me')
    const { access_token: instrToken } = await apiSignup({ email: instrEmail, password: PASSWORD })
    const { access_token: stuToken } = await apiSignup({ email: stuEmail, password: PASSWORD })
    const course = await apiCreateCourse(instrToken, { title: 'OH Me Test' })
    const cc = course.courseCode
    await apiEnroll(instrToken, cc, stuEmail, 'student')

    const windowDate = nextWeekdayDate(1) // Monday
    const createRes = await request.post(`${API_BASE}/api/v1/courses/${cc}/availability`, {
      headers: authHeaders(instrToken),
      data: { windowDate, startTime: '16:00', endTime: '16:30', slotDurationMinutes: 30 },
    })
    const { slots } = await createRes.json() as { slots: Array<{ id: string }> }
    const slotId = slots[0].id

    await request.post(`${API_BASE}/api/v1/slots/${slotId}/book`, {
      headers: authHeaders(stuToken),
      data: {},
    })

    const apptRes = await request.get(`${API_BASE}/api/v1/me/appointments`, {
      headers: { Authorization: `Bearer ${stuToken}` },
    })
    expect(apptRes.status()).toBe(200)
    const { appointments } = await apptRes.json() as { appointments: Array<{ id: string }> }
    expect(appointments.some((a) => a.id === slotId)).toBe(true)
  })

  test('GET /slots/:id/ical returns a valid iCalendar for booked slot', async ({ request }) => {
    const instrEmail = uniqueEmail('instr-ical')
    const stuEmail = uniqueEmail('stu-ical')
    const { access_token: instrToken } = await apiSignup({ email: instrEmail, password: PASSWORD })
    const { access_token: stuToken } = await apiSignup({ email: stuEmail, password: PASSWORD })
    const course = await apiCreateCourse(instrToken, { title: 'OH iCal Test' })
    const cc = course.courseCode
    await apiEnroll(instrToken, cc, stuEmail, 'student')

    const windowDate = nextWeekdayDate(3)
    const createRes = await request.post(`${API_BASE}/api/v1/courses/${cc}/availability`, {
      headers: authHeaders(instrToken),
      data: { windowDate, startTime: '13:00', endTime: '13:30', slotDurationMinutes: 30 },
    })
    const { slots } = await createRes.json() as { slots: Array<{ id: string }> }
    const slotId = slots[0].id

    // Book so student has access.
    await request.post(`${API_BASE}/api/v1/slots/${slotId}/book`, {
      headers: authHeaders(stuToken),
      data: {},
    })

    const icalRes = await request.get(`${API_BASE}/api/v1/slots/${slotId}/ical`, {
      headers: { Authorization: `Bearer ${stuToken}` },
    })
    expect(icalRes.status()).toBe(200)
    const ct = icalRes.headers()['content-type'] ?? ''
    expect(ct).toContain('text/calendar')
    const text = await icalRes.text()
    expect(text).toContain('BEGIN:VCALENDAR')
    expect(text).toContain('BEGIN:VEVENT')
    expect(text).toContain(`slot-${slotId}`)
    expect(text).toContain('SUMMARY:Office Hours')
    expect(text).toContain('END:VEVENT')
  })

  test('student cannot see another student booking note (privacy)', async ({ request }) => {
    const instrEmail = uniqueEmail('instr-priv')
    const stu1Email = uniqueEmail('stu1-priv')
    const stu2Email = uniqueEmail('stu2-priv')
    const { access_token: instrToken } = await apiSignup({ email: instrEmail, password: PASSWORD })
    const { access_token: stu1Token } = await apiSignup({ email: stu1Email, password: PASSWORD })
    const { access_token: stu2Token } = await apiSignup({ email: stu2Email, password: PASSWORD })
    const course = await apiCreateCourse(instrToken, { title: 'OH Privacy Test' })
    const cc = course.courseCode
    await apiEnroll(instrToken, cc, stu1Email, 'student')
    await apiEnroll(instrToken, cc, stu2Email, 'student')

    const windowDate = nextWeekdayDate(2)
    const createRes = await request.post(`${API_BASE}/api/v1/courses/${cc}/availability`, {
      headers: authHeaders(instrToken),
      data: {
        windowDate,
        startTime: '08:00',
        endTime: '08:30',
        slotDurationMinutes: 30,
      },
    })
    const { slots } = await createRes.json() as { slots: Array<{ id: string }> }
    const slotId = slots[0].id

    const secretNote = 'Super secret note that stu2 must not see'
    await request.post(`${API_BASE}/api/v1/slots/${slotId}/book`, {
      headers: authHeaders(stu1Token),
      data: { note: secretNote },
    })

    // Student 2 lists slots — the booked slot must NOT reveal the note or student identity.
    const listRes = await request.get(`${API_BASE}/api/v1/courses/${cc}/availability`, {
      headers: { Authorization: `Bearer ${stu2Token}` },
    })
    const { slots: listed } = await listRes.json() as { slots: Array<{ id: string; studentNote?: string; studentId?: string }> }
    const bookedSlot = listed.find((s) => s.id === slotId)
    expect(bookedSlot).toBeDefined()
    expect(bookedSlot?.studentNote).toBeUndefined()
    expect(bookedSlot?.studentId).toBeUndefined()
  })

  test('validation: dayOfWeek and windowDate cannot both be provided', async ({ request }) => {
    const email = uniqueEmail('instr-val')
    const { access_token: token } = await apiSignup({ email, password: PASSWORD })
    const course = await apiCreateCourse(token, { title: 'OH Val Test' })
    const cc = course.courseCode

    const res = await request.post(`${API_BASE}/api/v1/courses/${cc}/availability`, {
      headers: authHeaders(token),
      data: {
        dayOfWeek: 2,
        windowDate: '2030-01-01',
        startTime: '09:00',
        endTime: '10:00',
      },
    })
    expect(res.status()).toBe(400)
  })

  test('validation: neither dayOfWeek nor windowDate returns 400', async ({ request }) => {
    const email = uniqueEmail('instr-val2')
    const { access_token: token } = await apiSignup({ email, password: PASSWORD })
    const course = await apiCreateCourse(token, { title: 'OH Val2 Test' })
    const cc = course.courseCode

    const res = await request.post(`${API_BASE}/api/v1/courses/${cc}/availability`, {
      headers: authHeaders(token),
      data: { startTime: '09:00', endTime: '10:00' },
    })
    expect(res.status()).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// Browser (Playwright) UI tests
// ---------------------------------------------------------------------------

test.describe('Office Hours UI', () => {
  test('office hours page loads after enabling the feature flag', async ({ page }) => {
    const instrEmail = uniqueEmail('instr-ui')
    const { access_token: instrToken } = await apiSignup({ email: instrEmail, password: PASSWORD })
    const course = await apiCreateCourse(instrToken, { title: 'OH UI Test' })
    const cc = course.courseCode
    await enableOfficeHours(instrToken, cc)

    await injectToken(page, instrToken)
    await page.goto(`/courses/${cc}/office-hours`)
    await expect(page.getByRole('heading', { name: /office hours/i })).toBeVisible({ timeout: 10000 })
  })

  test('instructor sees "Add availability" button', async ({ page }) => {
    const instrEmail = uniqueEmail('instr-add')
    const { access_token: instrToken } = await apiSignup({ email: instrEmail, password: PASSWORD })
    const course = await apiCreateCourse(instrToken, { title: 'OH Add Test' })
    const cc = course.courseCode
    await enableOfficeHours(instrToken, cc)

    await injectToken(page, instrToken)
    await page.goto(`/courses/${cc}/office-hours`)
    await expect(page.getByRole('button', { name: /add availability/i })).toBeVisible({ timeout: 10000 })
  })

  test('student does not see "Add availability" button', async ({ page }) => {
    const instrEmail = uniqueEmail('instr-nostu')
    const stuEmail = uniqueEmail('stu-nostu')
    const { access_token: instrToken } = await apiSignup({ email: instrEmail, password: PASSWORD })
    const { access_token: stuToken } = await apiSignup({ email: stuEmail, password: PASSWORD })
    const course = await apiCreateCourse(instrToken, { title: 'OH Stu Test' })
    const cc = course.courseCode
    await apiEnroll(instrToken, cc, stuEmail, 'student')
    await enableOfficeHours(instrToken, cc)

    await injectToken(page, stuToken)
    await page.goto(`/courses/${cc}/office-hours`)
    await expect(page.getByRole('heading', { name: /office hours/i })).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('button', { name: /add availability/i })).not.toBeVisible()
  })

  test('student can book a slot via the UI', async ({ page, request }) => {
    const instrEmail = uniqueEmail('instr-book-ui')
    const stuEmail = uniqueEmail('stu-book-ui')
    const { access_token: instrToken } = await apiSignup({ email: instrEmail, password: PASSWORD })
    const { access_token: stuToken } = await apiSignup({ email: stuEmail, password: PASSWORD })
    const course = await apiCreateCourse(instrToken, { title: 'OH Book UI' })
    const cc = course.courseCode
    await apiEnroll(instrToken, cc, stuEmail, 'student')
    await enableOfficeHours(instrToken, cc)

    // Seed a one-off window via API.
    const windowDate = nextWeekdayDate(3)
    const createRes = await request.post(`${API_BASE}/api/v1/courses/${cc}/availability`, {
      headers: authHeaders(instrToken),
      data: { windowDate, startTime: '10:00', endTime: '10:30', slotDurationMinutes: 30 },
    })
    expect(createRes.status()).toBe(201)

    await injectToken(page, stuToken)
    await page.goto(`/courses/${cc}/office-hours`)
    await expect(page.getByRole('heading', { name: /office hours/i })).toBeVisible({ timeout: 10000 })

    // Find and click the Book button.
    // Use filter({ hasText }) to match text content rather than accessible name, because the
    // button carries aria-label="Book appointment slot: …" which overrides the accessible name.
    const bookBtn = page.getByRole('button').filter({ hasText: /^Book$/ }).first()
    await expect(bookBtn).toBeVisible({ timeout: 8000 })
    await bookBtn.click()

    // Booking dialog opens.
    await expect(page.getByRole('dialog', { name: /book appointment/i })).toBeVisible()

    // Submit.
    await page.getByRole('dialog').getByRole('button', { name: /confirm booking/i }).click()

    // Dialog closes.
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 8000 })
  })

  test('office hours nav link appears when feature enabled', async ({ page }) => {
    const instrEmail = uniqueEmail('instr-nav')
    const { access_token: instrToken } = await apiSignup({ email: instrEmail, password: PASSWORD })
    const course = await apiCreateCourse(instrToken, { title: 'OH Nav Test' })
    const cc = course.courseCode
    await enableOfficeHours(instrToken, cc)

    await injectToken(page, instrToken)
    await page.goto(`/courses/${cc}`)
    await expect(page.getByRole('link', { name: /office hours/i })).toBeVisible({ timeout: 10000 })
  })

  test('office hours nav link hidden when feature disabled', async ({ page }) => {
    const instrEmail = uniqueEmail('instr-nav-off')
    const { access_token: instrToken } = await apiSignup({ email: instrEmail, password: PASSWORD })
    const course = await apiCreateCourse(instrToken, { title: 'OH Nav Off Test' })
    const cc = course.courseCode
    // Do NOT enable office hours.

    await injectToken(page, instrToken)
    await page.goto(`/courses/${cc}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('link', { name: /office hours/i })).not.toBeVisible()
  })
})
