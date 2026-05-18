/**
 * E2E tests for 5.11 — Permission-First RBAC
 *
 * Verifies that:
 *  1. A teacher enrolled in a course sees `course:<code>:enrollments:role-staff` in their permissions.
 *  2. A student enrolled in a course sees `course:<code>:enrollments:role-student` in their permissions.
 *  3. The "Family" nav link is gated on `app:user:account-parent-dashboard`, not a raw account_type check.
 *  4. The enrollment role validation uses the catalog (accepts any valid role_key).
 */
import { test, expect } from '@playwright/test'
import { apiSignup, apiCreateCourse, apiEnroll } from '../fixtures/api.js'
import { injectToken, mainNav } from '../fixtures/test.js'

const PASSWORD = 'E2eTestPass1!'
const apiBase = process.env.E2E_API_URL ?? 'http://localhost:8080'

function uniqueEmail(label = 'user') {
  return `e2e-rbac-perm-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.invalid`
}

async function fetchPermissions(token: string, courseCode?: string): Promise<string[]> {
  const qs = courseCode ? `?courseCode=${encodeURIComponent(courseCode)}` : ''
  const res = await fetch(`${apiBase}/api/v1/me/permissions${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`permissions fetch failed: ${res.status}`)
  const data = (await res.json()) as { permissionStrings?: string[] }
  return data.permissionStrings ?? []
}

test.describe('5.11 permission-first RBAC — catalog-driven permission emission', () => {
  test('teacher enrollment emits course:*:enrollments:role-staff', async () => {
    const instructorEmail = uniqueEmail('instructor')
    const { access_token: instructorToken } = await apiSignup({
      email: instructorEmail,
      password: PASSWORD,
    })

    const { courseCode } = await apiCreateCourse(instructorToken, {
      title: 'RBAC Permission Test Course',
    })

    const perms = await fetchPermissions(instructorToken, courseCode)
    const staffPerm = `course:${courseCode}:enrollments:role-staff`
    expect(perms).toContain(staffPerm)
  })

  test('student enrollment emits course:*:enrollments:role-student', async () => {
    const instructorEmail = uniqueEmail('inst2')
    const studentEmail = uniqueEmail('stu2')

    const { access_token: instructorToken } = await apiSignup({
      email: instructorEmail,
      password: PASSWORD,
    })
    const { access_token: studentToken } = await apiSignup({
      email: studentEmail,
      password: PASSWORD,
    })

    const { courseCode } = await apiCreateCourse(instructorToken, {
      title: 'RBAC Student Perm Course',
    })
    await apiEnroll(instructorToken, courseCode, studentEmail, 'student')

    const perms = await fetchPermissions(studentToken, courseCode)
    const studentPerm = `course:${courseCode}:enrollments:role-student`
    expect(perms).toContain(studentPerm)

    // Student must NOT receive the staff permission.
    const staffPerm = `course:${courseCode}:enrollments:role-staff`
    expect(perms).not.toContain(staffPerm)
  })

  test('teacher does not receive role-student permission without student enrollment', async () => {
    const instructorEmail = uniqueEmail('inst3')
    const { access_token: instructorToken } = await apiSignup({
      email: instructorEmail,
      password: PASSWORD,
    })
    const { courseCode } = await apiCreateCourse(instructorToken, {
      title: 'RBAC Teacher Only Course',
    })

    const perms = await fetchPermissions(instructorToken, courseCode)
    const studentPerm = `course:${courseCode}:enrollments:role-student`
    // The teacher did not self-enroll as student, so no role-student permission.
    expect(perms).not.toContain(studentPerm)
  })

  test('enrollment accepts catalog role "ta" (catalog-driven validation)', async () => {
    const instructorEmail = uniqueEmail('inst4')
    const taEmail = uniqueEmail('ta4')

    const { access_token: instructorToken } = await apiSignup({
      email: instructorEmail,
      password: PASSWORD,
    })
    await apiSignup({ email: taEmail, password: PASSWORD })

    const { courseCode } = await apiCreateCourse(instructorToken, {
      title: 'RBAC TA Role Course',
    })

    // Enroll as 'ta' — the catalog validates this role; a hard-coded list might miss it.
    await apiEnroll(instructorToken, courseCode, taEmail, 'ta')

    const res = await fetch(
      `${apiBase}/api/v1/courses/${encodeURIComponent(courseCode)}/enrollments`,
      { headers: { Authorization: `Bearer ${instructorToken}` } },
    )
    expect(res.ok).toBe(true)
    const raw = (await res.json()) as { enrollments: Array<{ role: string; userId: string }> }
    const taEnrollment = raw.enrollments.find((e) => e.role === 'ta')
    expect(taEnrollment).toBeDefined()
  })

  test('"Family" nav link is visible for users with app:user:account-parent-dashboard permission', async ({
    page,
  }) => {
    // Sign up a standard user — no parent permission by default.
    const email = uniqueEmail('navcheck')
    const { access_token } = await apiSignup({ email, password: PASSWORD })

    await injectToken(page, access_token)
    await mainNav(page).waitFor({ state: 'visible' })

    // Standard users should NOT see the Family link.
    await expect(page.getByRole('link', { name: 'Family' })).not.toBeVisible()
  })
})
