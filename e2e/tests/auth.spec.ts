/**
 * Authentication flows
 *
 * Checklist coverage (docs/e2e.md):
 *   [x] Sign up with email and password → redirected to dashboard
 *   [x] Log in with valid credentials → redirected to dashboard
 *   [x] Log in with wrong password → error message shown
 *   [x] Redirect to /login when visiting protected route unauthenticated
 *   [x] Log out → session cleared, redirected to /login
 */
import { test, expect } from '@playwright/test'
import { apiSignup } from '../fixtures/api.js'

const PASSWORD = 'E2eTestPass1!'

function uniqueEmail() {
  return `e2e-auth-${Date.now()}-${Math.random().toString(36).slice(2)}@test.invalid`
}

/** Inject a JWT into localStorage so the app considers the browser session authenticated. */
async function injectToken(page: import('@playwright/test').Page, token: string) {
  await page.goto('/')
  await page.evaluate((t) => localStorage.setItem('studydrift_access_token', t), token)
  await page.goto('/')
}

test.describe('Sign up', () => {
  test('creates account and redirects to dashboard', async ({ page }) => {
    const email = uniqueEmail()

    await page.goto('/signup')

    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill(PASSWORD)
    await page.getByRole('button', { name: /create account/i }).click()

    // After signup the user lands on the dashboard (root path).
    await expect(page).toHaveURL('/')
    // The app shell nav is present — confirms the user is authenticated.
    await expect(page.getByRole('navigation')).toBeVisible()
  })
})

test.describe('Log in', () => {
  test('valid credentials redirect to dashboard', async ({ page }) => {
    const email = uniqueEmail()
    // Seed the user via API so the login form can be tested in isolation.
    await apiSignup({ email, password: PASSWORD })

    await page.goto('/login')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill(PASSWORD)
    await page.getByRole('button', { name: /sign in/i }).click()

    await expect(page).toHaveURL('/')
    await expect(page.getByRole('navigation')).toBeVisible()
  })

  test('wrong password shows error message', async ({ page }) => {
    const email = uniqueEmail()
    await apiSignup({ email, password: PASSWORD })

    await page.goto('/login')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill('WrongPassword99!')
    await page.getByRole('button', { name: /sign in/i }).click()

    // The form should NOT navigate away.
    await expect(page).toHaveURL('/login')
    // An error message is rendered via role="status".
    const errorMsg = page.locator('[role="status"]')
    await expect(errorMsg).toBeVisible()
    await expect(errorMsg).not.toBeEmpty()
  })
})

test.describe('Unauthenticated access', () => {
  test('redirects to /login for protected routes', async ({ page }) => {
    // Visit a protected route with no token in storage.
    await page.goto('/courses')
    await expect(page).toHaveURL('/login')
  })
})

test.describe('Log out', () => {
  test('clears session and redirects to /login', async ({ page }) => {
    const email = uniqueEmail()
    const { access_token } = await apiSignup({ email, password: PASSWORD })

    // Authenticate by injecting the JWT directly.
    await injectToken(page, access_token)
    await expect(page.getByRole('navigation')).toBeVisible()

    // Open the user menu (top-bar button with aria-label="User menu").
    await page.getByRole('button', { name: 'User menu' }).click()

    // Click "Sign out" inside the dropdown.
    await page.getByRole('menuitem', { name: /sign out/i }).click()

    // Session should be cleared and user redirected to /login.
    await expect(page).toHaveURL('/login')
    const token = await page.evaluate(() => localStorage.getItem('studydrift_access_token'))
    expect(token).toBeNull()
  })
})
