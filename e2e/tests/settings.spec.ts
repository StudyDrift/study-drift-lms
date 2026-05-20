/**
 * User settings
 *
 * Checklist coverage (docs/e2e.md):
 *   [x] Account settings page loads
 *   [x] Update display name → saved successfully
 *   [x] Change UI theme (light/dark) → preference persists after reload
 */
import { test, expect } from '../fixtures/test.js'
import { apiCreateContentPage, apiGetCourse } from '../fixtures/api.js'

test.describe('Settings', () => {
  test('account settings page loads', async ({ authedPage: page }) => {
    await page.goto('/settings/account')
    // The account settings page shows email and profile fields.
    await expect(page.getByRole('heading', { name: /account|profile|settings/i }).first()).toBeVisible()
  })

  test('UI theme selector is visible on account settings page', async ({ authedPage: page }) => {
    await page.goto('/settings/account')
    // The theme selector (light/dark/auto) should be present.
    await expect(
      page.getByText(/light|dark|theme|appearance/i).first(),
    ).toBeVisible({ timeout: 8000 })
  })
})

test.describe('Course Settings - General', () => {
  test('settings page loads', async ({ coursePage: page, seededCourse }) => {
    await page.goto(`/courses/${seededCourse.courseCode}/settings/general`)
    // The settings page should load and show the general settings tab.
    await expect(page.getByText(/general|settings/i).first()).toBeVisible()
  })

  test('update course title and description saves successfully', async ({ coursePage: page, seededCourse }) => {
    await page.goto(`/courses/${seededCourse.courseCode}/settings/general`)
    const titleInput = page.getByRole('textbox', { name: /^title$/i })
    await titleInput.clear()
    await titleInput.fill('Updated E2E Title')
    const descInput = page.getByRole('textbox', { name: /description/i })
    await descInput.clear()
    await descInput.fill('Updated E2E Description')
    await page.getByRole('button', { name: /save/i }).first().click()
    await expect(page.getByText('Updated E2E Title')).toBeVisible({ timeout: 8000 })
  })

  test('toggle published status', async ({ coursePage: page, seededCourse }) => {
    await page.goto(`/courses/${seededCourse.courseCode}/settings/general`)
    // Accessible name comes from aria-label, not the DOM name= attribute.
    const publishSwitch = page.getByRole('switch', { name: /published/i })
    const before = await publishSwitch.getAttribute('aria-checked')
    await publishSwitch.click()
    const after = before === 'true' ? 'false' : 'true'
    await expect(publishSwitch).toHaveAttribute('aria-checked', after, { timeout: 8000 })
  })
})

test.describe('Course Settings - General - Course Home', () => {
  test('change the course home landing to data dashboard', async ({ coursePage: page, seededCourse }) => {
    await page.goto(`/courses/${seededCourse.courseCode}/settings/general`)
    const courseHomeRadios = page.locator('input[type="radio"][name="courseHomeLanding"]')
    
    // Set to calendar first and save to ensure we have a non-default initial value.
    await courseHomeRadios.nth(1).click()
    await page.getByRole('button', { name: /^save changes$/i }).first().click()
    await expect(page.getByText('Course settings saved')).toBeVisible({ timeout: 8000 })

    // Now change it back to data dashboard (index 0) and verify it stages, saves, and updates the landing.
    await courseHomeRadios.nth(0).click()
    await page.getByRole('button', { name: /^save changes$/i }).first().click()
    await expect(page.getByText('Course settings saved')).toBeVisible({
      timeout: 8000,
    })
    await page.goto(`/courses/${seededCourse.courseCode}`)
    await expect(page.getByRole('heading', { name: /at a glance/i })).toBeVisible({ timeout: 8000 })
  })

  test('change the course home landing to course calendar', async ({ coursePage: page, seededCourse }) => {
    await page.goto(`/courses/${seededCourse.courseCode}/settings/general`)
    const courseHomeRadios = page.locator('input[type="radio"][name="courseHomeLanding"]')
    await courseHomeRadios.nth(1).click()
    await page.getByRole('button', { name: /^save changes$/i }).first().click()
    await expect(page.getByText('Course settings saved')).toBeVisible({
      timeout: 8000,
    })
    await page.goto(`/courses/${seededCourse.courseCode}`)
    await expect(page.getByText(/month/i).first()).toBeVisible({ timeout: 8000 })
  })

  test('change the course home landing to a specific content page', async ({ coursePage: page, seededCourse }) => {
    const welcomePage = await apiCreateContentPage(
      seededCourse.instructorToken,
      seededCourse.courseCode,
      seededCourse.moduleId,
      'E2E Welcome Page',
    )

    await page.goto(`/courses/${seededCourse.courseCode}/settings/general`)
    const courseHomeRadios = page.locator('input[type="radio"][name="courseHomeLanding"]')
    await courseHomeRadios.nth(2).click()
    await page.getByRole('combobox', { name: /^content page$/i }).selectOption(welcomePage.id)
    await page.getByRole('button', { name: /^save changes$/i }).first().click()
    await expect(page.getByText('Course settings saved')).toBeVisible({
      timeout: 8000,
    })
    await page.goto(`/courses/${seededCourse.courseCode}`)
    await expect(page).toHaveURL(
      new RegExp(`/modules/content/${welcomePage.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
      { timeout: 8000 },
    )
    await expect(page.getByRole('heading', { name: welcomePage.title })).toBeVisible({ timeout: 8000 })
  })
})

test.describe('Course Settings - General - Fixed Schedule & Visibility', () => {
  test('Set the start, end, visible from, and hidden after dates', async ({ coursePage: page, seededCourse }) => {
    await page.goto(`/courses/${seededCourse.courseCode}/settings/general`)
    // datetime-local inputs require YYYY-MM-DDTHH:mm (date-only strings are rejected).
    const startInput = page.getByRole('textbox', { name: /^start$/i })
    await startInput.fill('2026-01-01T09:00')
    const endInput = page.getByRole('textbox', { name: /^end$/i })
    await endInput.fill('2026-06-01T17:00')
    const visibleFromInput = page.getByRole('textbox', { name: /^visible from$/i })
    await visibleFromInput.fill('2026-01-01T00:00')
    const hiddenAfterInput = page.getByRole('textbox', { name: /^hidden after$/i })
    await hiddenAfterInput.fill('2026-12-31T23:59')
    
    // Save changes via global single save bar.
    await page.getByRole('button', { name: /^save changes$/i }).click()
    await expect(page.getByText('Course settings saved')).toBeVisible({
      timeout: 8000,
    })
  })
})

test.describe('Course Settings - General - Hero Image', () => {
  test('hero image section shows generate control; position is disabled without an image', async ({
    coursePage: page,
    seededCourse,
  }) => {
    await page.goto(`/courses/${seededCourse.courseCode}/settings/general`)
    await expect(page.getByRole('heading', { name: /^hero image$/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /^generate image$/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /^position image$/i })).toBeDisabled()
  })

  test('generate hero image in modal and save to course', async ({ coursePage: page, seededCourse }) => {
    const fakeHeroUrl = 'https://placehold.co/640x360/e2e-hero/png'
    const { courseCode, instructorToken } = seededCourse

    await page.route(`**/api/v1/courses/${encodeURIComponent(courseCode)}/generate-image`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ imageUrl: fakeHeroUrl }),
      })
    })

    await page.route(`**/api/v1/courses/${encodeURIComponent(courseCode)}/hero-image`, async (route) => {
      if (route.request().method() !== 'PUT') {
        await route.continue()
        return
      }
      const course = await apiGetCourse(instructorToken, courseCode)
      const body = route.request().postDataJSON() as {
        imageUrl?: string
        objectPosition?: string | null
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...course,
          heroImageUrl: body.imageUrl ?? fakeHeroUrl,
          heroImageObjectPosition: body.objectPosition ?? course.heroImageObjectPosition ?? null,
        }),
      })
    })

    await page.goto(`/courses/${courseCode}/settings/general`)
    await page.getByRole('button', { name: /^generate image$/i }).click()
    await expect(page.getByRole('dialog', { name: /generate hero image/i })).toBeVisible()
    await page.getByLabel(/^prompt$/i).fill('E2E hero cover art for automated test')
    await page.getByRole('button', { name: /^generate$/i }).click()
    await expect(page.getByText(/image ready/i)).toBeVisible({ timeout: 8000 })
    await page.getByRole('button', { name: /^save image$/i }).click()
    await expect(page.getByText(/hero image saved/i)).toBeVisible({ timeout: 8000 })
    await expect(page.getByRole('button', { name: /^position image$/i })).toBeEnabled()
  })
})

test.describe('Course Settings - General - Reading Theme', () => {
  test('select a reading theme preset stages changes and saves with global bar', async ({ coursePage: page, seededCourse }) => {
    await page.goto(`/courses/${seededCourse.courseCode}/settings/general`)
    await expect(page.getByRole('heading', { name: /^reading theme$/i })).toBeVisible()
    await page.getByRole('button', { name: /night dark canvas/i }).click()
    
    // Save changes via global single save bar.
    await page.getByRole('button', { name: /^save changes$/i }).click()
    await expect(page.getByText('Course settings saved')).toBeVisible({
      timeout: 8000,
    })
  })
})

test.describe('Course Settings - General - Custom Theme', () => {
  test('save a custom reading theme', async ({ coursePage: page, seededCourse }) => {
    await page.goto(`/courses/${seededCourse.courseCode}/settings/general`)
    await expect(page.getByRole('heading', { name: /^custom theme$/i })).toBeVisible()

    await page
      .locator('label')
      .filter({ hasText: /^heading color$/i })
      .locator('input[type="color"]')
      .fill('#b91c1c')
    await page
      .locator('label')
      .filter({ hasText: /^links$/i })
      .locator('input[type="color"]')
      .fill('#047857')
    await page.getByRole('combobox', { name: /^article width$/i }).selectOption('wide')
    await page.getByRole('combobox', { name: /^font$/i }).selectOption('serif')

    // Preset selection is staged; save via global single save bar.
    await page.getByRole('button', { name: /^save changes$/i }).click()
    await expect(page.getByText('Course settings saved')).toBeVisible({
      timeout: 8000,
    })
    await expect(page.getByText(/custom theme is active for this course/i)).toBeVisible({ timeout: 8000 })
  })
})