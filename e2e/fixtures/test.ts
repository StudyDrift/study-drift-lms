/**
 * Extended Playwright fixtures providing pre-authenticated pages and seeded data.
 */
import { test as base, type Page } from '@playwright/test'
import { apiSignup, apiCreateCourse, apiCreateModule, apiEnroll } from './api.js'

export interface UserCredentials {
  email: string
  password: string
  displayName?: string
}

export interface SeededCourse {
  courseCode: string
  title: string
  description?: string
  instructorToken: string
  instructorEmail: string
  studentToken: string
  studentEmail: string
  moduleId: string
  moduleTitle: string
}

export interface TestFixtures {
  authedToken: string
  authedPage: Page
  seededCourse: SeededCourse
  coursePage: Page
}

let _seq = 0
export function uniqueEmail(label = 'user'): string {
  return `e2e-${label}-${Date.now()}-${++_seq}@test.invalid`
}

/** Inject a JWT and suppress all one-time onboarding modals so they never block tests. */
export async function injectToken(page: Page, token: string) {
  await page.goto('/')
  await page.evaluate((t) => {
    localStorage.setItem('studydrift_access_token', t)
    localStorage.setItem('lextures-search-shortcut-tip-dismissed', '1')
    localStorage.setItem(
      'lextures.onboarding.v1',
      JSON.stringify({ student: true, teacher: true, admin: true }),
    )
  }, token)
  await page.goto('/')
}

/** The main sidebar nav — confirms the user is authenticated and the app shell is loaded. */
export function mainNav(page: Page) {
  return page.getByRole('navigation', { name: 'Main' })
}

export const test = base.extend<TestFixtures>({
  authedToken: async ({ }, use) => {
    const { access_token } = await apiSignup({
      email: uniqueEmail('auth'),
      password: 'E2eTestPass1!',
    })
    await use(access_token)
  },

  authedPage: async ({ page, authedToken }, use) => {
    await injectToken(page, authedToken)
    await use(page)
  },

  seededCourse: [
    async ({ }, use) => {
      const instructorEmail = uniqueEmail('inst')
      const { access_token: instructorToken } = await apiSignup({
        email: instructorEmail,
        password: 'E2eTestPass1!',
        displayName: 'E2E Instructor',
      })

      const studentEmail = uniqueEmail('student')
      const { access_token: studentToken } = await apiSignup({
        email: studentEmail,
        password: 'E2eTestPass1!',
        displayName: 'E2E Student',
      })

      const course = await apiCreateCourse(instructorToken, { title: 'E2E Test Course' })
      // Re-enroll the instructor via the enrollment endpoint so RefreshManagedGrantsForCourseUser
      // runs and inserts the user_course_grants row for item:create.  CreateCourse only inserts
      // the course_enrollments row without triggering the grant refresh.
      await apiEnroll(instructorToken, course.courseCode, instructorEmail, 'teacher')
      await apiEnroll(instructorToken, course.courseCode, studentEmail, 'student')
      const mod = await apiCreateModule(instructorToken, course.courseCode, 'Unit 1')

      await use({
        courseCode: course.courseCode,
        title: course.title,
        instructorToken,
        instructorEmail,
        studentToken,
        studentEmail,
        moduleId: mod.id,
        moduleTitle: mod.title ?? 'Unit 1',
      })
    },
    { scope: 'test' },
  ],

  coursePage: async ({ page, seededCourse }, use) => {
    await injectToken(page, seededCourse.instructorToken)
    await use(page)
  },
})

export { expect } from '@playwright/test'
