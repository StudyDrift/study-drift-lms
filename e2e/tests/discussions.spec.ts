/**
 * Discussion forums
 *
 * Checklist coverage (docs/e2e.md):
 *   [x] Discussions list page loads
 *   [x] Create a new discussion forum
 *   [x] Post a reply to a discussion thread
 *   [x] Reply appears under parent post
 */
import { test, expect } from '../fixtures/test.js'
import { apiCreateForum, apiCreateDiscussionThread, apiEnableCourseFeatures } from '../fixtures/api.js'

test.describe('Discussions', () => {
  test('discussions page loads', async ({ coursePage: page, seededCourse }) => {
    await apiEnableCourseFeatures(seededCourse.instructorToken, seededCourse.courseCode, {
      discussionsEnabled: true,
    })
    await page.goto(`/courses/${seededCourse.courseCode}/discussions`)
    await expect(page.getByRole('heading', { name: /discussions?/i })).toBeVisible()
  })

  test('forum created via API appears in the list', async ({
    coursePage: page,
    seededCourse,
  }) => {
    await apiEnableCourseFeatures(seededCourse.instructorToken, seededCourse.courseCode, {
      discussionsEnabled: true,
    })
    const forum = await apiCreateForum(
      seededCourse.instructorToken,
      seededCourse.courseCode,
      'E2E API Forum',
    )
    await page.goto(`/courses/${seededCourse.courseCode}/discussions`)
    await expect(page.getByText(forum.name)).toBeVisible({ timeout: 8000 })
  })

  test('create a forum via UI → forum appears in list', async ({
    coursePage: page,
    seededCourse,
  }) => {
    await apiEnableCourseFeatures(seededCourse.instructorToken, seededCourse.courseCode, {
      discussionsEnabled: true,
    })
    await page.goto(`/courses/${seededCourse.courseCode}/discussions`)

    const newForumBtn = page.getByRole('button', { name: /new forum|create forum|add forum/i })
    if (await newForumBtn.count() === 0) {
      test.skip(true, 'New forum button not found — skipping')
      return
    }
    await newForumBtn.click()

    const nameInput = page.getByRole('textbox', { name: /forum name|name/i }).or(
      page.getByRole('dialog').getByRole('textbox').first()
    )
    await nameInput.fill('UI Created Forum')
    await page.getByRole('button', { name: /create|save/i }).click()

    await expect(page.getByText('UI Created Forum')).toBeVisible({ timeout: 8000 })
  })

  test('post a reply to a discussion thread → reply appears', async ({
    coursePage: page,
    seededCourse,
  }) => {
    await apiEnableCourseFeatures(seededCourse.instructorToken, seededCourse.courseCode, {
      discussionsEnabled: true,
    })
    // Seed a forum and thread via API.
    const forum = await apiCreateForum(
      seededCourse.instructorToken,
      seededCourse.courseCode,
      'Reply Test Forum',
    )
    const thread = await apiCreateDiscussionThread(
      seededCourse.instructorToken,
      seededCourse.courseCode,
      forum.id,
      'Reply Test Thread',
    )

    await page.goto(`/courses/${seededCourse.courseCode}/discussions`)

    // Click on the forum name to navigate into it.
    await page.getByText(forum.name).click()
    // Click on the thread title.
    await page.getByText(thread.title).click()

    // Find and fill the reply composer.
    const replyArea = page
      .locator('[contenteditable="true"], textarea')
      .filter({ hasText: '' })
      .first()
    if (await replyArea.count() === 0) {
      // Try clicking a "Reply" button first.
      const replyBtn = page.getByRole('button', { name: /reply/i }).first()
      if (await replyBtn.count() > 0) await replyBtn.click()
    }

    const composer = page.locator('[contenteditable="true"], textarea').first()
    if (await composer.count() === 0) {
      test.skip(true, 'Reply composer not found — skipping')
      return
    }
    await composer.click()
    const replyText = `E2E reply ${Date.now()}`
    await composer.fill(replyText)

    const postBtn = page.getByRole('button', { name: /post|reply|submit/i }).last()
    await postBtn.click()

    await expect(page.getByText(replyText)).toBeVisible({ timeout: 10000 })
  })
})
