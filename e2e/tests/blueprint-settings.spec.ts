/**
 * Course Settings → Blueprint: org admin gate and blueprint designation toggle.
 */
import { test, expect } from '../fixtures/test.js'

test.describe('Course Settings - Blueprint', () => {
  test('blueprint tab loads and shows admin-access message for non-org-admin', async ({
    coursePage: page,
    seededCourse,
  }) => {
    await page.goto(`/courses/${seededCourse.courseCode}/settings/blueprint`)
    await expect(page.getByRole('heading', { name: /^Blueprint$/i })).toBeVisible({ timeout: 12000 })
    // Non-org-admin users see a restriction message
    await expect(
      page.getByText(/Ask your platform admin for access/i),
    ).toBeVisible({ timeout: 8000 })
  })

  test('blueprint tab shows description text', async ({ coursePage: page, seededCourse }) => {
    await page.goto(`/courses/${seededCourse.courseCode}/settings/blueprint`)
    await expect(page.getByRole('heading', { name: /^Blueprint$/i })).toBeVisible({ timeout: 12000 })
    await expect(page.getByText(/Org administrators manage district blueprint courses/i)).toBeVisible()
  })
})
