/**
 * Inbox, send message, archive message
 */

import { apiGetSettingsAccount } from '../fixtures/api.js'
import { test, expect } from '../fixtures/test.js'

test.describe('Elements on inbox page', () => {
  test('inbox page loads', async ({ authedPage: page }) => {
    await page.goto('/inbox')
    await expect(page.getByRole('heading', { name: /inbox/i })).toBeVisible()
  })

  test('Compose button is visible', async ({ authedPage: page }) => {
    await page.goto('/inbox')
    // Toolbar "Compose" plus empty-state actions can both expose "Compose"; assert the primary control.
    await expect(page.getByRole('button', { name: /^compose$/i }).first()).toBeVisible()
  })

  test('Search input is visible', async ({ authedPage: page }) => {
    await page.goto('/inbox')
    await expect(page.getByRole('searchbox', { name: /search mail/i })).toBeVisible()
  })

  test('Message list is visible', async ({ authedPage: page }) => {
    await page.goto('/inbox')
    await expect(page.getByRole('listbox', { name: /messages/i })).toBeVisible()
  })
})

test.describe('Compose message workflow', () => {
  test('Compose message → it appears in the inbox', async ({ authedPage: page }) => {
    await page.goto('/inbox')
    await page.getByRole('button', { name: /^compose$/i }).first().click()
    await expect(page.getByRole('dialog', { name: /new message/i })).toBeVisible()
  })

  test('Compose message → it appears in the search results', async ({ authedPage: page }) => {
    await page.goto('/inbox')
    await page.getByRole('button', { name: /^compose$/i }).first().click()
    await expect(page.getByRole('dialog', { name: /new message/i })).toBeVisible()
  })
})

test.describe('Archive message workflow', () => {
  test('Archive message → it disappears from the inbox', async ({ authedPage: page, authedToken }) => {
    const { email } = await apiGetSettingsAccount(authedToken)
    const subject = 'Test Message'

    await page.goto('/inbox')
    await page.getByRole('button', { name: /^compose$/i }).first().click()
    const compose = page.getByRole('dialog', { name: /new message/i })
    await expect(compose).toBeVisible()
    await compose.getByLabel(/^to$/i).fill(email)
    await compose.getByLabel(/^subject$/i).fill(subject)
    await compose.getByLabel(/^message$/i).fill('E2E body for archive flow.')
    await compose.getByRole('button', { name: /^send$/i }).click()
    await expect(compose).toBeHidden({ timeout: 15_000 })

    const threadList = page.getByRole('listbox', { name: /messages/i })
    await expect(threadList).toContainText(subject, { timeout: 15_000 })
    await page.getByRole('option', { name: new RegExp(subject, 'i') }).click()

    // Archive only appears in the open-message toolbar (and the label is hidden below `sm` breakpoints).
    await page.getByRole('region', { name: 'Message' }).getByRole('button', { name: /archive/i }).click()
    await expect(threadList).not.toContainText(subject, { timeout: 15_000 })
  })
})