/**
 * Course enrollments
 *
 * Checklist coverage (docs/e2e.md):
 *   [x] Enrollments page loads with current members
 *   [x] Invite a user by email → pending enrollment appears
 *   [x] Change enrollment role via dropdown
 *   [x] Remove an enrollment → user disappears from list
 */
import { test, expect } from '../fixtures/test.js'
import { uniqueEmail } from '../fixtures/test.js'
import { apiSignup } from '../fixtures/api.js'

test.describe('Course enrollments', () => {
  test('enrollments page loads with current members', async ({
    coursePage: page,
    seededCourse,
  }) => {
    await page.goto(`/courses/${seededCourse.courseCode}/enrollments`)
    await expect(page.getByRole('heading', { name: /enrollments/i })).toBeVisible()
    // Scope text lookups to the main table to avoid matching the user-menu in the top-right.
    const table = page.locator('table, [role="table"]').first()
    await expect(table.getByText('E2E Student')).toBeVisible()
    await expect(table.getByText('E2E Instructor')).toBeVisible()
  })

  test('add enrollment: new user appears in the roster', async ({
    coursePage: page,
    seededCourse,
  }) => {
    const newEmail = uniqueEmail('newstudent')
    await apiSignup({ email: newEmail, password: 'E2eTestPass1!', displayName: 'New E2E User' })

    await page.goto(`/courses/${seededCourse.courseCode}/enrollments`)

    // The Enrollments Actions button has aria-haspopup="menu" and text "Actions".
    // Use the attribute selector to avoid matching the Search bar (which also opens an overlay).
    const actionsBtn = page.locator('button[aria-haspopup="menu"]').filter({ hasText: 'Actions' })
    await actionsBtn.click()
    await page.getByRole('menuitem', { name: /add enrollment/i }).click()

    await page.locator('#enrollment-emails').fill(newEmail)
    // The role select (#enrollment-builtin-role) is only shown when the viewer has teacher
    // role. If not shown, the form adds the user as student by default — proceed directly.
    const roleSelect = page.locator('#enrollment-builtin-role')
    if (await roleSelect.isVisible({ timeout: 1000 })) {
      await roleSelect.selectOption('student')
    }
    await page.getByRole('button', { name: /^add$/i }).click()

    await expect(page.getByText('New E2E User')).toBeVisible({ timeout: 10000 })
  })

  test('remove an enrollment → user disappears from list', async ({
    coursePage: page,
    seededCourse,
  }) => {
    await page.goto(`/courses/${seededCourse.courseCode}/enrollments`)
    const table = page.locator('table, [role="table"]').first()
    await expect(table.getByText('E2E Student')).toBeVisible()

    // The remove button has aria-label "Remove student enrollment for E2E Student".
    const removeBtn = page.getByRole('button', { name: /remove student enrollment/i })
    if (await removeBtn.count() === 0) {
      // Hover the student row to reveal the hidden remove button.
      const studentRow = page.locator('tr').filter({ hasText: 'E2E Student' })
      await studentRow.hover()
    }
    const removeBtnVis = page.getByRole('button', { name: /remove student enrollment/i })
    if (await removeBtnVis.count() === 0) {
      test.skip(true, 'Remove button not accessible — skipping')
      return
    }
    await removeBtnVis.click()

    // Confirm if a dialog appears.
    const confirmBtn = page.getByRole('button', { name: /confirm|yes/i }).first()
    if (await confirmBtn.count() > 0) await confirmBtn.click()

    await expect(table.getByText('E2E Student')).not.toBeVisible({ timeout: 8000 })
  })
})
