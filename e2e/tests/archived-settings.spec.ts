/**
 * Course Settings → Archive: archived content list, unarchive, delete course, factory reset.
 */
import { test, expect } from '../fixtures/test.js'
import { apiCreateAssignment, apiArchiveCourseStructureItem } from '../fixtures/api.js'

test.describe('Course Settings - Archived', () => {
  test('archive tab loads with archived content intro text', async ({ coursePage: page, seededCourse }) => {
    await page.goto(`/courses/${seededCourse.courseCode}/settings/archive`)
    await expect(
      page.getByText(/Archived module items are hidden from students/i),
    ).toBeVisible({ timeout: 12000 })
  })

  test('archive tab shows empty state when nothing is archived', async ({
    coursePage: page,
    seededCourse,
  }) => {
    await page.goto(`/courses/${seededCourse.courseCode}/settings/archive`)
    await expect(
      page.getByText(/Archived module items are hidden from students/i),
    ).toBeVisible({ timeout: 12000 })
    await expect(page.getByText(/No archived content/i)).toBeVisible({ timeout: 8000 })
  })

  test('archived assignment appears in list and can be unarchived', async ({
    coursePage: page,
    seededCourse,
  }) => {
    // Create and archive an assignment via API
    const assignment = await apiCreateAssignment(
      seededCourse.instructorToken,
      seededCourse.courseCode,
      seededCourse.moduleId,
      'E2E Archive Test Assignment',
    )
    await apiArchiveCourseStructureItem(
      seededCourse.instructorToken,
      seededCourse.courseCode,
      assignment.id,
    )

    await page.goto(`/courses/${seededCourse.courseCode}/settings/archive`)
    await expect(
      page.getByText(/Archived module items are hidden from students/i),
    ).toBeVisible({ timeout: 12000 })

    // Archived assignment should appear in the table
    await expect(page.getByText('E2E Archive Test Assignment')).toBeVisible({ timeout: 8000 })
    await expect(page.getByRole('cell', { name: 'Assignment', exact: true })).toBeVisible()

    // Unarchive it
    const row = page.locator('tr').filter({ hasText: 'E2E Archive Test Assignment' })
    await row.getByRole('button', { name: /^Unarchive$/i }).click()

    // Should disappear from the list
    await expect.poll(async () => {
      return await page.getByText('E2E Archive Test Assignment').isVisible()
    }, { timeout: 8000 }).toBe(false)

    // Empty state returns
    await expect(page.getByText(/No archived content/i)).toBeVisible({ timeout: 8000 })
  })

  test('Delete Course button opens confirmation dialog', async ({ coursePage: page, seededCourse }) => {
    await page.goto(`/courses/${seededCourse.courseCode}/settings/archive`)
    await expect(
      page.getByText(/Archived module items are hidden from students/i),
    ).toBeVisible({ timeout: 12000 })

    await page.getByRole('button', { name: /^Delete Course$/i }).click()
    const dialog = page.getByRole('dialog', { name: /Delete course/i })
    await expect(dialog).toBeVisible({ timeout: 8000 })
    await expect(dialog.getByText(/archives the entire course/i)).toBeVisible()

    // Cancel closes dialog without archiving
    await dialog.getByRole('button', { name: /^Cancel$/i }).click()
    await expect(dialog).not.toBeVisible({ timeout: 5000 })
  })

  test('Factory Reset Course button opens confirmation dialog', async ({
    coursePage: page,
    seededCourse,
  }) => {
    await page.goto(`/courses/${seededCourse.courseCode}/settings/archive`)
    await expect(
      page.getByText(/Archived module items are hidden from students/i),
    ).toBeVisible({ timeout: 12000 })

    await page.getByRole('button', { name: /^Factory Reset Course$/i }).click()
    const dialog = page.getByRole('dialog', { name: /Factory reset course/i })
    await expect(dialog).toBeVisible({ timeout: 8000 })
    await expect(dialog.getByText(/permanently deletes all modules/i)).toBeVisible()

    // Cancel closes dialog
    await dialog.getByRole('button', { name: /^Cancel$/i }).click()
    await expect(dialog).not.toBeVisible({ timeout: 5000 })
  })
})
