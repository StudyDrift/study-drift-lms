/**
 * Course Settings → Outcomes: create/edit outcomes, link graded assignments, persistence via API.
 */
import type { Locator, Page } from '@playwright/test'
import { test, expect } from '../fixtures/test.js'
import { apiCreateAssignment, apiGetCourseOutcomes } from '../fixtures/api.js'

async function gotoOutcomes(page: Page, courseCode: string) {
  await page.goto(`/courses/${courseCode}/settings/outcomes`)
  await expect(page.getByRole('heading', { name: /^Learning outcomes$/i })).toBeVisible({ timeout: 12000 })
}

function outcomeCardCandidates(page: Page): Locator {
  return page.locator('section').filter({ hasText: 'Linked graded work' })
}

/** Outcome cards are `<section>`s; match the title via the controlled outcome title field (stable vs CSS class strings). */
async function outcomeCard(page: Page, title: string): Promise<Locator> {
  const candidates = outcomeCardCandidates(page)
  let found: Locator | null = null
  await expect
    .poll(
      async () => {
        found = null
        const n = await candidates.count()
        for (let i = 0; i < n; i++) {
          const card = candidates.nth(i)
          const v = await card.getByRole('textbox', { name: /^Outcome title$/ }).inputValue()
          if (v === title) {
            found = card
            return true
          }
        }
        return false
      },
      { timeout: 12000 },
    )
    .toBe(true)
  if (!found) throw new Error(`Outcome card not found: ${title}`)
  return found
}

async function expectNoOutcomeCardWithTitle(page: Page, title: string) {
  await expect
    .poll(
      async () => {
        const candidates = outcomeCardCandidates(page)
        const n = await candidates.count()
        for (let i = 0; i < n; i++) {
          const v = await candidates.nth(i).getByRole('textbox', { name: /^Outcome title$/ }).inputValue()
          if (v === title) return false
        }
        return true
      },
      { timeout: 12000 },
    )
    .toBe(true)
}

/** "Add another outcome" lives inside `<details>`; do not filter the whole `<details>` with /^…$/ — it also contains form copy. */
function addAnotherOutcomeDetails(page: Page) {
  return page.locator('details').filter({ has: page.locator('summary').filter({ hasText: 'Add another outcome' }) })
}

test.describe('Course Settings - Outcomes', () => {
  test('outcomes tab loads intro and expandable rollup explainer', async ({ coursePage: page, seededCourse }) => {
    await gotoOutcomes(page, seededCourse.courseCode)
    await expect(page.getByText(/State what learners should demonstrate/i)).toBeVisible()
    const rollup = page.locator('details').filter({ hasText: /How scores roll up into outcome progress/i })
    await rollup.locator('summary').click()
    await expect(page.getByText(/Class progress uses gradebook scores/i)).toBeVisible({ timeout: 8000 })
  })

  test('create outcome persists on the course', async ({ coursePage: page, seededCourse }) => {
    await gotoOutcomes(page, seededCourse.courseCode)
    await page.getByPlaceholder('e.g. Analyze primary sources').fill('E2E Outcome Alpha')
    await page.getByPlaceholder('What should learners be able to do?').fill('Demonstrates learner-facing outcomes text.')
    await page.getByRole('button', { name: /^Create outcome$/i }).click()

    await outcomeCard(page, 'E2E Outcome Alpha')

    const data = await apiGetCourseOutcomes(seededCourse.instructorToken, seededCourse.courseCode)
    const o = data.outcomes.find((x) => x.title === 'E2E Outcome Alpha')
    expect(o).toBeTruthy()
    expect(o?.description).toContain('learner-facing')
  })

  test('edit outcome metadata saves and survives reload', async ({ coursePage: page, seededCourse }) => {
    await gotoOutcomes(page, seededCourse.courseCode)
    await page.getByPlaceholder('e.g. Analyze primary sources').fill('E2E Meta Outcome')
    await page.getByRole('button', { name: /^Create outcome$/i }).click()
    const card = await outcomeCard(page, 'E2E Meta Outcome')
    await card.locator('input').first().fill('E2E Meta Outcome Updated')
    await card.locator('textarea').first().fill('Rewritten outcome description.')
    await page.getByRole('button', { name: /^Save changes$/i }).click()

    await expect.poll(async () => {
      const d = await apiGetCourseOutcomes(seededCourse.instructorToken, seededCourse.courseCode)
      return d.outcomes.some((x) => x.title === 'E2E Meta Outcome Updated')
    }).toBe(true)

    await page.reload()
    await expect(page.getByRole('heading', { name: /^Learning outcomes$/i })).toBeVisible({ timeout: 12000 })
    const updatedCard = await outcomeCard(page, 'E2E Meta Outcome Updated')
    await expect(updatedCard).toBeVisible()
    await expect(updatedCard.locator('textarea').first()).toHaveValue('Rewritten outcome description.')
  })

  test('add assignment link with measurement and emphasis; UI and API agree; remove link', async ({
    coursePage: page,
    seededCourse,
  }) => {
    await gotoOutcomes(page, seededCourse.courseCode)
    await page.getByPlaceholder('e.g. Analyze primary sources').fill('E2E Linked Outcome')
    await page.getByRole('button', { name: /^Create outcome$/i }).click()
    await outcomeCard(page, 'E2E Linked Outcome')

    const assignment = await apiCreateAssignment(
      seededCourse.instructorToken,
      seededCourse.courseCode,
      seededCourse.moduleId,
      'E2E Evidence Assignment',
    )
    await page.reload()
    await expect(page.getByRole('heading', { name: /^Learning outcomes$/i })).toBeVisible({ timeout: 12000 })

    const card = await outcomeCard(page, 'E2E Linked Outcome')
    await card.getByRole('combobox', { name: /Module assignment or quiz/i }).selectOption(assignment.id)
    await card.getByRole('combobox', { name: /measurement role/i }).selectOption('summative')
    await card.getByRole('combobox', { name: /^Emphasis/i }).selectOption('high')
    await card.getByRole('button', { name: /^Add link$/i }).click()

    // `load()` after a successful link runs from the parent and remounts the card; stale locators miss the new DOM.
    const linkedCard = await outcomeCard(page, 'E2E Linked Outcome')
    await expect(linkedCard.getByRole('button', { name: /Remove link/i })).toBeVisible({ timeout: 12000 })
    const linkRow = linkedCard.locator('li').filter({ hasText: assignment.title })
    await expect(linkRow.filter({ hasText: /Summative/ })).toBeVisible({ timeout: 5000 })
    await expect(linkRow.filter({ hasText: /Strong emphasis/ })).toBeVisible({ timeout: 5000 })

    const afterAdd = await apiGetCourseOutcomes(seededCourse.instructorToken, seededCourse.courseCode)
    const oc = afterAdd.outcomes.find((x) => x.title === 'E2E Linked Outcome')
    expect(oc?.links).toHaveLength(1)
    expect(oc?.links[0]?.targetKind).toBe('assignment')
    expect(oc?.links[0]?.measurementLevel).toBe('summative')
    expect(oc?.links[0]?.intensityLevel).toBe('high')

    await linkedCard.getByRole('button', { name: /Remove link/i }).click()

    const afterRemoveCard = await outcomeCard(page, 'E2E Linked Outcome')
    await expect(afterRemoveCard.getByText(/No links yet/)).toBeVisible({ timeout: 12000 })
    const afterRemove = await apiGetCourseOutcomes(seededCourse.instructorToken, seededCourse.courseCode)
    const oc2 = afterRemove.outcomes.find((x) => x.title === 'E2E Linked Outcome')
    expect(oc2?.links ?? []).toHaveLength(0)
  })

  test('add another outcome from collapsed form', async ({ coursePage: page, seededCourse }) => {
    await gotoOutcomes(page, seededCourse.courseCode)
    await page.getByPlaceholder('e.g. Analyze primary sources').fill('E2E Outcome First')
    await page.getByRole('button', { name: /^Create outcome$/i }).click()
    await outcomeCard(page, 'E2E Outcome First')

    const addAnother = addAnotherOutcomeDetails(page)
    await addAnother.locator('summary').click()
    await addAnother.getByPlaceholder('e.g. Analyze primary sources').fill('E2E Outcome Second')
    await addAnother.getByRole('button', { name: /^Create outcome$/i }).click()

    await outcomeCard(page, 'E2E Outcome Second')
    const data = await apiGetCourseOutcomes(seededCourse.instructorToken, seededCourse.courseCode)
    expect(data.outcomes.map((o) => o.title)).toEqual(expect.arrayContaining(['E2E Outcome First', 'E2E Outcome Second']))
  })

  test('delete outcome removes it after typing DELETE', async ({ coursePage: page, seededCourse }) => {
    await gotoOutcomes(page, seededCourse.courseCode)
    await page.getByPlaceholder('e.g. Analyze primary sources').fill('E2E Outcome Trash')
    await page.getByRole('button', { name: /^Create outcome$/i }).click()

    const card = await outcomeCard(page, 'E2E Outcome Trash')
    await card.getByRole('button', { name: /^Delete outcome$/ }).click()

    const dialog = page.locator('[role="dialog"]').filter({ hasText: /Delete learning outcome/i })
    await expect(dialog).toBeVisible({ timeout: 8000 })
    await dialog.locator('#confirm-dialog-phrase').fill('DELETE')
    await dialog.getByRole('button', { name: /^Delete outcome$/ }).click()

    await expectNoOutcomeCardWithTitle(page, 'E2E Outcome Trash')

    await expect.poll(async () => {
      const d = await apiGetCourseOutcomes(seededCourse.instructorToken, seededCourse.courseCode)
      return d.outcomes.every((x) => x.title !== 'E2E Outcome Trash')
    }).toBe(true)
  })
})
