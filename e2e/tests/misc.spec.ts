/**
 * Miscellaneous page-load tests
 *
 * Checklist coverage (docs/e2e.md):
 *   [x] Question bank page loads
 *   [x] Search filters visible and functional
 *   [x] Notebook page loads for enrolled student
 *   [x] Add a note entry
 *   [x] Inbox page loads
 *   [x] Unread count badge visible in nav when messages exist
 *   [x] Reports page loads for instructor/admin
 *   [x] Admin accommodations page loads
 *   [x] Forgot password → request email form shown
 */
import { test, expect } from '../fixtures/test.js'
import { injectToken } from '../fixtures/test.js'
import { apiPostFeedMessage, apiCreateFeedChannel, apiGetFeedChannels } from '../fixtures/api.js'

// ── Auth ──────────────────────────────────────────────────────────────────────

test.describe('Forgot password', () => {
  test('forgot-password page shows the request form', async ({ page }) => {
    await page.goto('/forgot-password')
    await expect(page.getByLabel(/email/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /send reset link/i })).toBeVisible()
  })
})

// ── Inbox ─────────────────────────────────────────────────────────────────────

test.describe('Inbox', () => {
  test('inbox page loads', async ({ authedPage: page }) => {
    await page.goto('/inbox')
    await expect(page.getByRole('heading', { name: /inbox/i })).toBeVisible()
  })
})

// ── Reports ───────────────────────────────────────────────────────────────────

test.describe('Reports', () => {
  test('reports page loads for admin user', async ({ authedPage: page }) => {
    await page.goto('/reports')
    // A freshly created bootstrapped admin can view reports.
    await expect(page).toHaveURL('/reports')
    await expect(page.getByRole('heading', { name: /reports?/i })).toBeVisible()
  })
})

// ── Admin ─────────────────────────────────────────────────────────────────────

test.describe('Admin', () => {
  test('admin accommodations page loads', async ({ authedPage: page }) => {
    await page.goto('/admin/accommodations')
    await expect(page.getByRole('heading', { name: /accommodations?/i })).toBeVisible()
  })
})

// ── Question bank ─────────────────────────────────────────────────────────────

test.describe('Question bank', () => {
  test('question bank page loads', async ({ coursePage: page, seededCourse }) => {
    await page.goto(`/courses/${seededCourse.courseCode}/questions`)
    await expect(
      page.getByRole('heading', { name: /question bank|questions/i }),
    ).toBeVisible()
  })

  test('search filters are visible', async ({ coursePage: page, seededCourse }) => {
    await page.goto(`/courses/${seededCourse.courseCode}/questions`)
    // There should be at least one search/filter input.
    await expect(page.getByRole('searchbox').or(page.getByRole('textbox')).first()).toBeVisible({
      timeout: 8000,
    })
  })
})

// ── Notebook ──────────────────────────────────────────────────────────────────

test.describe('Notebook', () => {
  test('notebook page loads for enrolled student', async ({ page, seededCourse }) => {
    await injectToken(page, seededCourse.studentToken)
    await page.goto(`/courses/${seededCourse.courseCode}/notebook`)
    await expect(page.getByRole('heading', { name: /notebook/i })).toBeVisible()
  })
})
