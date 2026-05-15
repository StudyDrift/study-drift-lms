/**
 * Course Settings → Features: toggle course tools on/off and verify persistence.
 */
import { test, expect } from '../fixtures/test.js'
import { apiGetCourse } from '../fixtures/api.js'

test.describe('Course Settings - Features', () => {
  test('features tab loads with Course tools heading', async ({ coursePage: page, seededCourse }) => {
    await page.goto(`/courses/${seededCourse.courseCode}/settings/features`)
    await expect(page.getByRole('heading', { name: /^Course tools$/i })).toBeVisible({ timeout: 12000 })
    await expect(page.getByText(/Turn tools on or off/i)).toBeVisible()
  })

  test('toggle Discussion forums on and verify Saved message', async ({ coursePage: page, seededCourse }) => {
    await page.goto(`/courses/${seededCourse.courseCode}/settings/features`)
    await expect(page.getByRole('heading', { name: /^Course tools$/i })).toBeVisible({ timeout: 12000 })

    // Find the Discussion forums row — contains a p with that label and a switch button
    const row = page.locator('div')
      .filter({ has: page.locator('p').filter({ hasText: 'Discussion forums' }) })
      .filter({ has: page.getByRole('switch') })
      .last()
    const toggle = row.getByRole('switch')
    await expect(toggle).toHaveAttribute('aria-checked', 'false', { timeout: 8000 })

    await toggle.click()
    await expect(page.getByRole('status').filter({ hasText: /Saved/i })).toBeVisible({ timeout: 8000 })
    await expect(toggle).toHaveAttribute('aria-checked', 'true', { timeout: 5000 })
  })

  test('enabled feature persists on the course record', async ({ coursePage: page, seededCourse }) => {
    await page.goto(`/courses/${seededCourse.courseCode}/settings/features`)
    await expect(page.getByRole('heading', { name: /^Course tools$/i })).toBeVisible({ timeout: 12000 })

    const row = page.locator('div')
      .filter({ has: page.locator('p').filter({ hasText: 'Discussion forums' }) })
      .filter({ has: page.getByRole('switch') })
      .last()
    const toggle = row.getByRole('switch')

    await toggle.click()
    await expect(page.getByRole('status').filter({ hasText: /Saved/i })).toBeVisible({ timeout: 8000 })

    await expect.poll(async () => {
      const data = await apiGetCourse(seededCourse.instructorToken, seededCourse.courseCode)
      return (data as Record<string, unknown>).discussionsEnabled
    }).toBe(true)
  })

  test('Course sections toggle enables sections feature', async ({ coursePage: page, seededCourse }) => {
    await page.goto(`/courses/${seededCourse.courseCode}/settings/features`)
    await expect(page.getByRole('heading', { name: /^Course tools$/i })).toBeVisible({ timeout: 12000 })

    const row = page.locator('div')
      .filter({ has: page.locator('p').filter({ hasText: 'Course sections' }) })
      .filter({ has: page.getByRole('switch') })
      .last()
    const toggle = row.getByRole('switch')

    await toggle.click()
    await expect(page.getByRole('status').filter({ hasText: /Saved/i })).toBeVisible({ timeout: 8000 })
    await expect(toggle).toHaveAttribute('aria-checked', 'true', { timeout: 5000 })

    await expect.poll(async () => {
      const data = await apiGetCourse(seededCourse.instructorToken, seededCourse.courseCode)
      return (data as Record<string, unknown>).sectionsEnabled
    }).toBe(true)
  })
})
