/**
 * Help widget (plan 6.8): floating launcher + contextual articles panel.
 *
 * Checklist coverage:
 *   [x] Help button is visible on authenticated pages
 *   [x] Clicking the button opens the help panel
 *   [x] Panel shows contextual article links
 *   [x] Search filters article list
 *   [x] Close button dismisses the panel
 *   [x] Escape key dismisses the panel
 *   [x] Contextual articles API returns articles for a route
 */
import { test, expect } from '../fixtures/test.js'
import { apiGetContextualArticles } from '../fixtures/api.js'

test.describe('Help Widget - UI', () => {
  test('help launcher button is visible on authenticated pages', async ({ authedPage: page }) => {
    await page.goto('/dashboard')
    await expect(page.getByRole('button', { name: 'Get help' })).toBeVisible({ timeout: 8000 })
  })

  test('clicking help button opens the help panel', async ({ authedPage: page }) => {
    await page.goto('/dashboard')
    const launcher = page.getByRole('button', { name: 'Get help' })
    await launcher.click()
    await expect(page.getByRole('dialog', { name: 'Help' })).toBeVisible({ timeout: 8000 })
  })

  test('help panel shows article links', async ({ authedPage: page }) => {
    await page.goto('/dashboard')
    await page.getByRole('button', { name: 'Get help' }).click()
    const dialog = page.getByRole('dialog', { name: 'Help' })
    await expect(dialog).toBeVisible({ timeout: 8000 })
    // Panel should show at least one article link once articles load
    await expect(dialog.getByRole('link').first()).toBeVisible({ timeout: 8000 })
  })

  test('search box filters articles', async ({ authedPage: page }) => {
    await page.goto('/dashboard')
    await page.getByRole('button', { name: 'Get help' }).click()
    const dialog = page.getByRole('dialog', { name: 'Help' })
    await expect(dialog).toBeVisible({ timeout: 8000 })
    // Wait for articles to load
    await expect(dialog.getByRole('link').first()).toBeVisible({ timeout: 8000 })
    const searchBox = dialog.getByRole('textbox', { name: /search help articles/i })
    await searchBox.fill('xxxxxxxx-no-match')
    await expect(dialog.getByText(/no articles matched/i)).toBeVisible({ timeout: 4000 })
  })

  test('close button dismisses the help panel', async ({ authedPage: page }) => {
    await page.goto('/dashboard')
    await page.getByRole('button', { name: 'Get help' }).click()
    await expect(page.getByRole('dialog', { name: 'Help' })).toBeVisible({ timeout: 8000 })
    await page.getByRole('button', { name: 'Close help panel' }).click()
    await expect(page.getByRole('dialog', { name: 'Help' })).not.toBeVisible({ timeout: 4000 })
  })

  test('Escape key closes the help panel', async ({ authedPage: page }) => {
    await page.goto('/dashboard')
    await page.getByRole('button', { name: 'Get help' }).click()
    await expect(page.getByRole('dialog', { name: 'Help' })).toBeVisible({ timeout: 8000 })
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Help' })).not.toBeVisible({ timeout: 4000 })
  })

  test('panel is accessible — dialog role and aria-modal', async ({ authedPage: page }) => {
    await page.goto('/dashboard')
    await page.getByRole('button', { name: 'Get help' }).click()
    const dialog = page.getByRole('dialog', { name: 'Help' })
    await expect(dialog).toBeVisible({ timeout: 8000 })
    await expect(dialog).toHaveAttribute('aria-modal', 'true')
  })

  test('panel shows course-related articles on a course page', async ({
    coursePage: page,
    seededCourse,
  }) => {
    await page.goto(`/courses/${seededCourse.courseCode}`)
    await page.getByRole('button', { name: 'Get help' }).click()
    const dialog = page.getByRole('dialog', { name: 'Help' })
    await expect(dialog).toBeVisible({ timeout: 8000 })
    // Course routes should return course-specific articles
    await expect(dialog.getByRole('link').first()).toBeVisible({ timeout: 8000 })
  })
})

test.describe('Help Widget - Contextual Articles API', () => {
  test('returns articles for a course route', async ({ authedToken }) => {
    const articles = await apiGetContextualArticles(authedToken, '/courses/abc123/modules')
    expect(articles.length).toBeGreaterThan(0)
    for (const a of articles) {
      expect(typeof a.title).toBe('string')
      expect(typeof a.url).toBe('string')
      expect(typeof a.slug).toBe('string')
      expect(a.title.length).toBeGreaterThan(0)
    }
  })

  test('returns articles for a quiz route', async ({ authedToken }) => {
    const articles = await apiGetContextualArticles(authedToken, '/quiz/abc123')
    expect(articles.length).toBeGreaterThan(0)
  })

  test('returns articles for a settings route', async ({ authedToken }) => {
    const articles = await apiGetContextualArticles(authedToken, '/settings/account')
    expect(articles.length).toBeGreaterThan(0)
  })

  test('returns default articles for an unknown route', async ({ authedToken }) => {
    const articles = await apiGetContextualArticles(authedToken, '/some-unknown-path')
    expect(articles.length).toBeGreaterThan(0)
  })

  test('returns articles for an empty route', async ({ authedToken }) => {
    const articles = await apiGetContextualArticles(authedToken, '')
    expect(articles.length).toBeGreaterThan(0)
  })

  test('requires authentication', async () => {
    const res = await fetch(
      `${process.env.E2E_API_URL ?? 'http://localhost:8080'}/api/v1/help/contextual-articles?route=/courses/abc`,
    )
    expect(res.status).toBe(401)
  })
})
