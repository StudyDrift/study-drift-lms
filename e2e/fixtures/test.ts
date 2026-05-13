/**
 * Extended Playwright fixtures providing a logged-in page and seeded user data.
 */
import { test as base, type Page } from '@playwright/test'
import { apiSignup, type UserCredentials } from './api.js'

export interface TestFixtures {
  /** A Page already signed in as a fresh test user (admin). */
  adminPage: Page
  /** Credentials for the admin test user. */
  adminCreds: UserCredentials
}

let _userSeq = 0
function nextEmail(): string {
  return `e2e-user-${Date.now()}-${++_userSeq}@test.invalid`
}

export const test = base.extend<TestFixtures>({
  adminCreds: async ({}, use) => {
    const creds: UserCredentials = {
      email: nextEmail(),
      password: 'E2ePassword1!',
      displayName: 'E2E Admin',
    }
    await use(creds)
  },

  adminPage: async ({ page, adminCreds }, use) => {
    // Sign up the user via API, then inject the token into localStorage so the
    // browser treats the session as authenticated without going through the UI form.
    const { access_token } = await apiSignup(adminCreds)
    await page.goto('/')
    await page.evaluate((token) => {
      localStorage.setItem('studydrift_access_token', token)
    }, access_token)
    // Navigate again so the app picks up the token.
    await page.goto('/')
    await use(page)
  },
})

export { expect } from '@playwright/test'
