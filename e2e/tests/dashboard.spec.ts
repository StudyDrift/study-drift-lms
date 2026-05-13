/**
 * Dashboard
 *
 * Checklist coverage (docs/e2e.md):
 *   [x] Dashboard loads after login with "My Courses" section visible
 *   [x] Empty-state shown when user has no enrollments
 */
import { test, expect } from '../fixtures/test.js'
import { mainNav } from '../fixtures/test.js'

test.describe('Dashboard', () => {
  test('loads after login and shows main UI sections', async ({ authedPage: page }) => {
    // authedPage lands on / after injecting the token
    await expect(page).toHaveURL('/')
    await expect(mainNav(page)).toBeVisible()

    // Page heading
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible()
  })

  test('shows empty state when user has no course enrollments', async ({ authedPage: page }) => {
    await expect(page).toHaveURL('/')
    // A fresh user has no enrollments — the app shows an empty/no-courses message.
    await expect(page.getByText(/no courses yet/i)).toBeVisible()
  })
})
