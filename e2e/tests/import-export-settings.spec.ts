/**
 * Course Settings → Import/Export: export download and import mode selector.
 */
import { test, expect } from '../fixtures/test.js'

test.describe('Course Settings - Import/Export', () => {
  test('import-export tab loads with Export and Import sections', async ({ coursePage: page, seededCourse }) => {
    await page.goto(`/courses/${seededCourse.courseCode}/settings/import-export`)
    await expect(page.getByRole('heading', { name: /^Export$/i })).toBeVisible({ timeout: 12000 })
    await expect(page.getByRole('heading', { name: /^Import$/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /Download JSON export/i })).toBeVisible()
  })

  test('export button triggers download and shows feedback', async ({ coursePage: page, seededCourse }) => {
    const { courseCode } = seededCourse

    // Mock the export endpoint so we don't need the real implementation
    await page.route(`**/api/v1/courses/${encodeURIComponent(courseCode)}/export`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ courseCode, title: 'E2E Export Test', modules: [] }),
      })
    })

    await page.goto(`/courses/${courseCode}/settings/import-export`)
    await expect(page.getByRole('button', { name: /Download JSON export/i })).toBeVisible({ timeout: 12000 })

    await page.getByRole('button', { name: /Download JSON export/i }).click()
    await expect(page.getByRole('status').filter({ hasText: /Export downloaded/i })).toBeVisible({
      timeout: 8000,
    })
  })

  test('import mode selector changes between modes', async ({ coursePage: page, seededCourse }) => {
    await page.goto(`/courses/${seededCourse.courseCode}/settings/import-export`)
    await expect(page.getByRole('heading', { name: /^Import$/i })).toBeVisible({ timeout: 12000 })

    // Default mode is "Erase and import"
    const eraseRadio = page.locator('input[type="radio"][name="importMode"]').nth(0)
    await expect(eraseRadio).toBeChecked()

    // Switch to "Add difference (merge)"
    const mergeRadio = page.locator('input[type="radio"][name="importMode"]').nth(1)
    await mergeRadio.click()
    await expect(mergeRadio).toBeChecked()
    await expect(eraseRadio).not.toBeChecked()

    // Switch to "Overwrite / sync"
    const overwriteRadio = page.locator('input[type="radio"][name="importMode"]').nth(2)
    await overwriteRadio.click()
    await expect(overwriteRadio).toBeChecked()
  })

  test('Canvas import fields are present', async ({ coursePage: page, seededCourse }) => {
    await page.goto(`/courses/${seededCourse.courseCode}/settings/import-export`)
    await expect(page.getByRole('heading', { name: /^Import$/i })).toBeVisible({ timeout: 12000 })

    await expect(page.getByText(/Canvas base URL/i)).toBeVisible()
    await expect(page.getByText(/Canvas course ID/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /Import from Canvas/i })).toBeVisible()
    // Canvas import button is disabled without credentials filled in
    await expect(page.getByRole('button', { name: /Import from Canvas/i })).toBeDisabled()
  })

  test('JSON file import button is visible', async ({ coursePage: page, seededCourse }) => {
    await page.goto(`/courses/${seededCourse.courseCode}/settings/import-export`)
    await expect(page.getByRole('heading', { name: /^Import$/i })).toBeVisible({ timeout: 12000 })

    await expect(page.getByRole('button', { name: /Choose JSON file/i })).toBeVisible()
  })
})
