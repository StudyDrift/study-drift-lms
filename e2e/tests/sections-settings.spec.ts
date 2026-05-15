/**
 * Course Settings → Sections: gate message, section creation, and due-date overrides UI.
 */
import { test, expect } from '../fixtures/test.js'
import { apiPatchCourseFeatures, apiGetCourseSections } from '../fixtures/api.js'

test.describe('Course Settings - Sections', () => {
  test('sections tab shows gate message when sections feature is disabled', async ({
    coursePage: page,
    seededCourse,
  }) => {
    await page.goto(`/courses/${seededCourse.courseCode}/settings/sections`)
    // The course has sections disabled by default; show the gate message
    await expect(
      page.getByText(/Turn on.*Course sections.*under the Features tab/i),
    ).toBeVisible({ timeout: 12000 })
  })

  test('sections tab shows section form after enabling sections feature', async ({
    coursePage: page,
    seededCourse,
  }) => {
    await apiPatchCourseFeatures(seededCourse.instructorToken, seededCourse.courseCode, {
      sectionsEnabled: true,
    })

    await page.goto(`/courses/${seededCourse.courseCode}/settings/sections`)
    await expect(page.getByRole('heading', { name: /^Sections$/i })).toBeVisible({ timeout: 12000 })
    await expect(page.getByRole('button', { name: /^Create section$/i })).toBeVisible()
  })

  test('create section persists and appears in list', async ({ coursePage: page, seededCourse }) => {
    await apiPatchCourseFeatures(seededCourse.instructorToken, seededCourse.courseCode, {
      sectionsEnabled: true,
    })

    await page.goto(`/courses/${seededCourse.courseCode}/settings/sections`)
    await expect(page.getByRole('heading', { name: /^Sections$/i })).toBeVisible({ timeout: 12000 })

    // Fill in section code and name
    await page.locator('input[placeholder="001"]').fill('E2E-001')
    await page.locator('input[placeholder="Morning lab"]').fill('E2E Morning Lab')
    await page.getByRole('button', { name: /^Create section$/i }).click()

    // Section should appear in the list (use li to avoid matching the override dropdown option)
    await expect(page.locator('li').filter({ hasText: 'E2E-001' })).toBeVisible({ timeout: 8000 })

    // Verify via API
    const sections = await apiGetCourseSections(seededCourse.instructorToken, seededCourse.courseCode)
    const created = sections.find((s) => s.sectionCode === 'E2E-001')
    expect(created).toBeTruthy()
    expect(created?.name).toBe('E2E Morning Lab')
    expect(created?.status).toBe('active')
  })

  test('section due date override form is visible with an active section', async ({
    coursePage: page,
    seededCourse,
  }) => {
    await apiPatchCourseFeatures(seededCourse.instructorToken, seededCourse.courseCode, {
      sectionsEnabled: true,
    })

    await page.goto(`/courses/${seededCourse.courseCode}/settings/sections`)
    await expect(page.getByRole('heading', { name: /^Sections$/i })).toBeVisible({ timeout: 12000 })

    // Create a section first
    await page.locator('input[placeholder="001"]').fill('E2E-002')
    await page.getByRole('button', { name: /^Create section$/i }).click()
    // Use li to avoid matching the override form's select option with the same code
    await expect(page.locator('li').filter({ hasText: 'E2E-002' })).toBeVisible({ timeout: 8000 })

    // Override form should be visible
    await expect(page.getByRole('heading', { name: /Section due date override/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Save override$/i })).toBeVisible()
    // Button should be disabled without section and assignment selected
    await expect(page.getByRole('button', { name: /^Save override$/i })).toBeDisabled()
  })
})
