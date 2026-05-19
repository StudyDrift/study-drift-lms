/**
 * Collaborative documents (plan 6.5)
 *
 * Checklist coverage:
 *   [x] Collab docs page gated behind feature flag
 *   [x] Enable feature → page loads with empty state
 *   [x] Create a doc via API → appears in the list
 *   [x] Create a doc via UI → appears in the list
 *   [x] Navigate into a doc → editor renders with status indicator
 *   [x] Delete a doc via UI (instructor only)
 */
import { test, expect } from '../fixtures/test.js'
import {
  apiCreateCollabDoc,
  apiDeleteCollabDoc,
  apiEnableCollabDocs,
  apiListCollabDocs,
} from '../fixtures/api.js'

test.describe('Collaborative documents', () => {
  // -----------------------------------------------------------------------
  // Feature gate
  // -----------------------------------------------------------------------
  test('collab docs page shows feature-disabled message when feature is off', async ({
    coursePage: page,
    seededCourse,
  }) => {
    // Feature is off by default — the page renders but shows a "not enabled" error.
    await page.goto(`/courses/${seededCourse.courseCode}/collab-docs`)
    await expect(
      page.getByText(/not enabled/i),
    ).toBeVisible({ timeout: 8000 })
    // The create button must not be present when the feature is disabled.
    await expect(page.getByRole('button', { name: /new document/i })).not.toBeVisible()
  })

  // -----------------------------------------------------------------------
  // Enabled state: list view
  // -----------------------------------------------------------------------
  test('collab docs page loads when feature is enabled', async ({
    coursePage: page,
    seededCourse,
  }) => {
    await apiEnableCollabDocs(seededCourse.instructorToken, seededCourse.courseCode)
    await page.goto(`/courses/${seededCourse.courseCode}/collab-docs`)
    await expect(
      page.getByRole('heading', { name: /collaborative documents/i }),
    ).toBeVisible({ timeout: 8000 })
  })

  test('doc created via API appears in the list', async ({
    coursePage: page,
    seededCourse,
  }) => {
    await apiEnableCollabDocs(seededCourse.instructorToken, seededCourse.courseCode)
    const doc = await apiCreateCollabDoc(
      seededCourse.instructorToken,
      seededCourse.courseCode,
      'API Created Doc',
    )

    await page.goto(`/courses/${seededCourse.courseCode}/collab-docs`)
    await expect(page.getByText(doc.title)).toBeVisible({ timeout: 8000 })
  })

  test('whiteboard doc shows whiteboard label in list', async ({
    coursePage: page,
    seededCourse,
  }) => {
    await apiEnableCollabDocs(seededCourse.instructorToken, seededCourse.courseCode)
    await apiCreateCollabDoc(
      seededCourse.instructorToken,
      seededCourse.courseCode,
      'My Whiteboard',
      'whiteboard',
    )

    await page.goto(`/courses/${seededCourse.courseCode}/collab-docs`)
    await expect(page.getByText('My Whiteboard')).toBeVisible({ timeout: 8000 })
    await expect(page.getByText(/whiteboard/i).first()).toBeVisible()
  })

  // -----------------------------------------------------------------------
  // Create via UI
  // -----------------------------------------------------------------------
  test('create a doc via UI → doc appears in list', async ({
    coursePage: page,
    seededCourse,
  }) => {
    await apiEnableCollabDocs(seededCourse.instructorToken, seededCourse.courseCode)
    await page.goto(`/courses/${seededCourse.courseCode}/collab-docs`)

    const newDocBtn = page.getByRole('button', { name: /new document/i })
    await expect(newDocBtn).toBeVisible({ timeout: 8000 })
    await newDocBtn.click()

    const titleInput = page.getByRole('textbox', { name: /document title/i })
    await expect(titleInput).toBeVisible()
    const docTitle = `UI Doc ${Date.now()}`
    await titleInput.fill(docTitle)

    await page.getByRole('button', { name: /^create$/i }).click()

    await expect(page.getByText(docTitle)).toBeVisible({ timeout: 8000 })
  })

  test('cancel new doc form dismisses without creating', async ({
    coursePage: page,
    seededCourse,
  }) => {
    await apiEnableCollabDocs(seededCourse.instructorToken, seededCourse.courseCode)
    await page.goto(`/courses/${seededCourse.courseCode}/collab-docs`)

    await page.getByRole('button', { name: /new document/i }).click()
    await expect(page.getByRole('textbox', { name: /document title/i })).toBeVisible()

    await page.getByRole('button', { name: /cancel/i }).click()

    // Form should be gone, new document button should be visible again.
    await expect(page.getByRole('textbox', { name: /document title/i })).not.toBeVisible()
    await expect(page.getByRole('button', { name: /new document/i })).toBeVisible()
  })

  // -----------------------------------------------------------------------
  // Editor view
  // -----------------------------------------------------------------------
  test('clicking a doc navigates to the editor page', async ({
    coursePage: page,
    seededCourse,
  }) => {
    await apiEnableCollabDocs(seededCourse.instructorToken, seededCourse.courseCode)
    const doc = await apiCreateCollabDoc(
      seededCourse.instructorToken,
      seededCourse.courseCode,
      'Editor Test Doc',
    )

    await page.goto(`/courses/${seededCourse.courseCode}/collab-docs`)
    await page.getByText(doc.title).click()

    // Editor page should show the doc title and a connection status indicator.
    await expect(
      page.getByText(/live|connecting/i).first(),
    ).toBeVisible({ timeout: 10000 })
  })

  test('direct URL to doc shows editor with status indicator', async ({
    coursePage: page,
    seededCourse,
  }) => {
    await apiEnableCollabDocs(seededCourse.instructorToken, seededCourse.courseCode)
    const doc = await apiCreateCollabDoc(
      seededCourse.instructorToken,
      seededCourse.courseCode,
      'Direct URL Doc',
    )

    await page.goto(`/courses/${seededCourse.courseCode}/collab-docs/${doc.id}`)
    // Should show the connection status bar (Live / Connecting… / Offline).
    await expect(
      page.getByText(/live|connecting|offline/i).first(),
    ).toBeVisible({ timeout: 10000 })
  })

  // -----------------------------------------------------------------------
  // Delete
  // -----------------------------------------------------------------------
  test('instructor can delete a doc via UI', async ({
    coursePage: page,
    seededCourse,
  }) => {
    await apiEnableCollabDocs(seededCourse.instructorToken, seededCourse.courseCode)
    const doc = await apiCreateCollabDoc(
      seededCourse.instructorToken,
      seededCourse.courseCode,
      'Doc To Delete',
    )

    await page.goto(`/courses/${seededCourse.courseCode}/collab-docs`)
    await expect(page.getByText(doc.title)).toBeVisible({ timeout: 8000 })

    // Confirm the browser dialog.
    page.once('dialog', (dialog) => void dialog.accept())
    await page.getByRole('button', { name: new RegExp(`delete.*${doc.title}`, 'i') }).click()

    await expect(page.getByText(doc.title)).not.toBeVisible({ timeout: 8000 })
  })

  // -----------------------------------------------------------------------
  // API-level: list/create/delete round-trip
  // -----------------------------------------------------------------------
  test('API: list is empty initially, create appears, delete removes it', async ({
    seededCourse,
  }) => {
    await apiEnableCollabDocs(seededCourse.instructorToken, seededCourse.courseCode)

    const before = await apiListCollabDocs(seededCourse.instructorToken, seededCourse.courseCode)
    expect(before).toHaveLength(0)

    const doc = await apiCreateCollabDoc(
      seededCourse.instructorToken,
      seededCourse.courseCode,
      'Round Trip Doc',
    )
    expect(doc.id).toBeTruthy()
    expect(doc.title).toBe('Round Trip Doc')
    expect(doc.docType).toBe('rich_text')

    const after = await apiListCollabDocs(seededCourse.instructorToken, seededCourse.courseCode)
    expect(after).toHaveLength(1)
    expect(after[0].id).toBe(doc.id)

    await apiDeleteCollabDoc(seededCourse.instructorToken, seededCourse.courseCode, doc.id)

    const afterDelete = await apiListCollabDocs(
      seededCourse.instructorToken,
      seededCourse.courseCode,
    )
    expect(afterDelete).toHaveLength(0)
  })

  // -----------------------------------------------------------------------
  // Sidebar navigation
  // -----------------------------------------------------------------------
  test('collab docs link appears in sidebar when feature is enabled', async ({
    coursePage: page,
    seededCourse,
  }) => {
    await apiEnableCollabDocs(seededCourse.instructorToken, seededCourse.courseCode)
    await page.goto(`/courses/${seededCourse.courseCode}`)
    await expect(
      page.getByRole('link', { name: /collab|collaborative|documents/i }),
    ).toBeVisible({ timeout: 8000 })
  })
})
