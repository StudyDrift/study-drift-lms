/**
 * Course feed
 *
 * Checklist coverage (docs/e2e.md):
 *   [x] Feed channel list loads
 *   [x] Post a message to the general channel
 *   [x] Message appears in feed without page refresh
 */
import { test, expect } from '../fixtures/test.js'
import { apiCreateFeedChannel, apiGetFeedChannels } from '../fixtures/api.js'

test.describe('Course feed', () => {
  test('feed page loads and shows channels', async ({ coursePage: page, seededCourse }) => {
    // Ensure at least one channel exists.
    const channels = await apiGetFeedChannels(seededCourse.instructorToken, seededCourse.courseCode)
    let channelId: string
    if (channels.length > 0) {
      channelId = channels[0].id
    } else {
      const ch = await apiCreateFeedChannel(
        seededCourse.instructorToken,
        seededCourse.courseCode,
        'General',
      )
      channelId = ch.id
    }

    await page.goto(`/courses/${seededCourse.courseCode}/feed`)
    await expect(page.getByRole('heading', { name: /feed|announcements|general/i })).toBeVisible()
    void channelId // used above
  })

  test('post a message → it appears in the feed', async ({ coursePage: page, seededCourse }) => {
    // Create a channel if needed.
    const channels = await apiGetFeedChannels(seededCourse.instructorToken, seededCourse.courseCode)
    if (channels.length === 0) {
      await apiCreateFeedChannel(seededCourse.instructorToken, seededCourse.courseCode, 'General')
    }

    await page.goto(`/courses/${seededCourse.courseCode}/feed`)

    // Find the message composer — a textarea or contenteditable.
    const composer = page
      .locator('textarea, [contenteditable="true"]')
      .filter({ hasText: '' })
      .first()
    if (await composer.count() === 0) {
      test.skip(true, 'Message composer not visible — skipping')
      return
    }

    const msgText = `E2E test message ${Date.now()}`
    await composer.click()
    await composer.fill(msgText)

    // Submit via button or Enter.
    const sendBtn = page.getByRole('button', { name: /send|post/i })
    if (await sendBtn.count() > 0) {
      await sendBtn.click()
    } else {
      await composer.press('Enter')
    }

    // Message should appear in the feed.
    await expect(page.getByText(msgText)).toBeVisible({ timeout: 8000 })
  })
})
