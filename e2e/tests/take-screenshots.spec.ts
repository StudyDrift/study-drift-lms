import { test, expect } from '@playwright/test'

test.skip(!!process.env.CI, 'docs screenshot generation — run locally only')

test('take course creation screenshots', async ({ page }) => {
  // Set standard viewport size
  await page.setViewportSize({ width: 1280, height: 800 })

  // 1. Login Page
  await page.goto('/login')
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible({ timeout: 12000 })
  await page.getByLabel('Email', { exact: true }).fill('willdenc@byui.edu')
  await page.getByLabel(/password/i).fill('willdenc@byui.edu')
  
  // Click sign in
  await page.getByRole('button', { name: /sign in/i }).click()

  // 2. Dashboard
  await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible({ timeout: 12000 })
  await page.screenshot({ path: '../www/public/docs-dashboard.png' })
  await page.screenshot({ path: '../www/public/docs-create-course-dashboard.png' })

  // Navigate to course creation page
  await page.goto('/courses/create')

  // 3. Step 1: Basics
  await expect(page.getByLabel('Title')).toBeVisible({ timeout: 12000 })
  await page.getByLabel('Title').fill('Introduction to Web Development')
  await page.screenshot({ path: '../www/public/docs-create-course-step1.png' })
  await page.getByRole('button', { name: /^continue$/i }).click()

  // 4. Step 2: Syllabus
  await expect(page.getByRole('button', { name: /^continue$/i })).toBeVisible({ timeout: 12000 })
  await page.screenshot({ path: '../www/public/docs-create-course-step2.png' })
  await page.getByRole('button', { name: /^continue$/i }).click()

  // 5. Step 3: Modules
  await expect(page.getByRole('button', { name: /skip module/i })).toBeVisible({ timeout: 12000 })
  await page.screenshot({ path: '../www/public/docs-create-course-step3.png' })
  await page.getByRole('button', { name: /skip module/i }).click()

  // 6. Success / Course detail page
  await expect(page).toHaveURL(/\/courses\/C-[A-Z0-9]+/, { timeout: 20000 })
  await page.waitForTimeout(2000)
  await page.screenshot({ path: '../www/public/docs-create-course-success.png' })
})
