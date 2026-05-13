/**
 * Calendar (course + global)
 *
 * Checklist coverage (docs/e2e.md):
 *   [x] Course calendar page loads with current month view
 *   [x] Global calendar loads
 */
import { test, expect } from '../fixtures/test.js'

test.describe('Calendar', () => {
  test('course calendar loads', async ({ coursePage: page, seededCourse }) => {
    await page.goto(`/courses/${seededCourse.courseCode}/calendar`)
    await expect(page.getByRole('heading', { name: /calendar/i })).toBeVisible()
    // A month view should show day-of-week headers or a month name.
    await expect(
      page.getByText(/monday|tuesday|wednesday|sun|mon|tue|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i).first(),
    ).toBeVisible({ timeout: 8000 })
  })

  test('global calendar loads', async ({ authedPage: page }) => {
    await page.goto('/calendar')
    await expect(page.getByRole('heading', { name: /calendar/i })).toBeVisible()
  })
})
