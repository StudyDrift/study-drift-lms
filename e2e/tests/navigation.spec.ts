/**
 * Navigation
 *
 * Checklist coverage (docs/e2e.md):
 *   [x] Sidebar navigation visible after login
 *   [x] Clicking "Courses" nav item navigates to /courses
 *   [x] Clicking "Inbox" nav item navigates to /inbox
 *   [x] Breadcrumb shows correct course title inside course pages
 */
import { test, expect } from '../fixtures/test.js'
import { mainNav } from '../fixtures/test.js'

test.describe('Navigation', () => {
  test('sidebar nav is visible after login', async ({ authedPage: page }) => {
    await expect(mainNav(page)).toBeVisible()
  })

  test('"Courses" nav link navigates to /courses', async ({ authedPage: page }) => {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Courses' }).click()
    await expect(page).toHaveURL('/courses')
  })

  test('"Inbox" nav link navigates to /inbox', async ({ authedPage: page }) => {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Inbox' }).click()
    await expect(page).toHaveURL('/inbox')
  })

  test('breadcrumb shows course title inside a course page', async ({ coursePage: page, seededCourse }) => {
    await page.goto(`/courses/${seededCourse.courseCode}`)
    // The breadcrumb nav contains the course title.
    const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' })
    await expect(breadcrumb).toContainText(seededCourse.title)
  })
})
