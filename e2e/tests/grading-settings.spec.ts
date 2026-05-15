/**
 * Course Settings → Grading: save flows and downstream gradebook/My Grades display.
 */
import { test, expect, injectToken, type SeededCourse } from '../fixtures/test.js'
import {
  apiCreateAssignment,
  apiGetCourseGrading,
  apiGetGradingScheme,
  apiListEnrollments,
  apiPatchAssignment,
  apiPutGradebookGrades,
} from '../fixtures/api.js'

async function enrollmentsWithGradedAssignment(
  seededCourse: Pick<SeededCourse, 'instructorToken' | 'courseCode' | 'moduleId'>,
  points: string,
) {
  const { instructorToken, courseCode, moduleId } = seededCourse
  const assignment = await apiCreateAssignment(
    instructorToken,
    courseCode,
    moduleId,
    'E2E graded item',
  )
  await apiPatchAssignment(instructorToken, courseCode, assignment.id, {
    pointsWorth: 100,
    postingPolicy: 'automatic',
  })
  const roster = await apiListEnrollments(instructorToken, courseCode)
  const student = roster.find((e) => e.role === 'student')
  if (!student) throw new Error('Expected a student enrollment')
  await apiPutGradebookGrades(instructorToken, courseCode, {
    [student.userId]: { [assignment.id]: points },
  })
  return { assignmentId: assignment.id, studentUserId: student.userId }
}

test.describe('Course Settings - Grading', () => {
  test('letter display: saves scheme and gradebook shows letter', async ({
    coursePage: page,
    seededCourse,
  }) => {
    const { studentUserId } = await enrollmentsWithGradedAssignment(seededCourse, '95')

    await page.goto(`/courses/${seededCourse.courseCode}/settings/grading`)
    await page.getByRole('combobox', { name: /display as/i }).selectOption('letter')
    await expect(page.locator('#grading-scheme-json')).toContainText('"A"', { timeout: 8000 })
    await page.getByRole('button', { name: /save grade display scheme/i }).click()
    await expect(page.getByText('Grading scheme saved.', { exact: true })).toBeVisible({
      timeout: 8000,
    })

    const apiScheme = await apiGetGradingScheme(seededCourse.instructorToken, seededCourse.courseCode)
    expect(apiScheme.scheme?.type).toBe('letter')

    await page.goto(`/courses/${seededCourse.courseCode}/gradebook`)
    await expect(page.getByRole('heading', { name: /gradebook/i })).toBeVisible()
    const learnerRow = page.locator(`#gradebook-row-${studentUserId}`)
    await expect(learnerRow).toBeVisible({ timeout: 8000 })
    const assignmentCell = learnerRow.locator('td[data-gradebook-cell]').first()
    await expect(assignmentCell.getByText('A', { exact: true })).toBeVisible({ timeout: 8000 })
  })

  test('letter grade shows on My Grades for the learner', async ({
    coursePage: instructorPage,
    page: learnerPage,
    seededCourse,
  }) => {
    await enrollmentsWithGradedAssignment(seededCourse, '95')

    await instructorPage.goto(`/courses/${seededCourse.courseCode}/settings/grading`)
    await instructorPage.getByRole('combobox', { name: /display as/i }).selectOption('letter')
    await instructorPage.getByRole('button', { name: /save grade display scheme/i }).click()
    await expect(
      instructorPage.getByText('Grading scheme saved.', { exact: true }),
    ).toBeVisible({ timeout: 8000 })

    await injectToken(learnerPage, seededCourse.studentToken)
    await learnerPage.goto(`/courses/${seededCourse.courseCode}/my-grades`)
    const assignmentRow = learnerPage.locator('tbody tr').filter({ hasText: 'E2E graded item' })
    await expect(assignmentRow.getByText('A', { exact: true })).toBeVisible({ timeout: 8000 })
  })

  test('pass/fail threshold: UI saves and gradebook shows Fail below threshold', async ({
    coursePage: page,
    seededCourse,
  }) => {
    const { studentUserId } = await enrollmentsWithGradedAssignment(seededCourse, '65')

    await page.goto(`/courses/${seededCourse.courseCode}/settings/grading`)
    await page.getByRole('combobox', { name: /display as/i }).selectOption('pass_fail')
    await page.locator('#pass-min-pct').fill('70')
    await page.getByRole('button', { name: /save grade display scheme/i }).click()
    await expect(page.getByText('Grading scheme saved.', { exact: true })).toBeVisible({
      timeout: 8000,
    })

    const apiScheme = await apiGetGradingScheme(seededCourse.instructorToken, seededCourse.courseCode)
    expect(apiScheme.scheme?.type).toBe('pass_fail')
    expect(apiScheme.scheme?.scaleJson).toMatchObject({ pass_min_pct: 70 })

    await page.goto(`/courses/${seededCourse.courseCode}/gradebook`)
    const learnerRow = page.locator(`#gradebook-row-${studentUserId}`)
    const assignmentCell = learnerRow.locator('td[data-gradebook-cell]').first()
    await expect(assignmentCell.getByText('Fail', { exact: true })).toBeVisible({ timeout: 8000 })
  })

  test('complete/incomplete: saves and gradebook shows Complete', async ({
    coursePage: page,
    seededCourse,
  }) => {
    const { studentUserId } = await enrollmentsWithGradedAssignment(seededCourse, '82')

    await page.goto(`/courses/${seededCourse.courseCode}/settings/grading`)
    await page.getByRole('combobox', { name: /display as/i }).selectOption('complete_incomplete')
    await page.locator('#complete-min-pct').fill('80')
    await page.getByRole('button', { name: /save grade display scheme/i }).click()
    await expect(page.getByText('Grading scheme saved.', { exact: true })).toBeVisible({
      timeout: 8000,
    })

    const apiScheme = await apiGetGradingScheme(seededCourse.instructorToken, seededCourse.courseCode)
    expect(apiScheme.scheme?.type).toBe('complete_incomplete')

    await page.goto(`/courses/${seededCourse.courseCode}/gradebook`)
    const learnerRow = page.locator(`#gradebook-row-${studentUserId}`)
    const assignmentCell = learnerRow.locator('td[data-gradebook-cell]').first()
    await expect(assignmentCell.getByText('Complete', { exact: true })).toBeVisible({ timeout: 8000 })
  })

  test('grading scale preset saves and persists', async ({ coursePage: page, seededCourse }) => {
    await page.goto(`/courses/${seededCourse.courseCode}/settings/grading`)

    await page.getByRole('radio', { name: /pass \/ fail/i }).click()
    await page.getByRole('button', { name: /^save grading settings$/i }).click()
    await expect(page.getByText(/grading settings saved/i)).toBeVisible({ timeout: 8000 })

    const g = await apiGetCourseGrading(seededCourse.instructorToken, seededCourse.courseCode)
    expect(g.gradingScale).toBe('pass_fail')

    await page.reload()
    await expect(page.getByRole('radio', { name: /pass \/ fail/i })).toBeChecked()
  })

  test('rename assignment group and verify after reload', async ({ coursePage: page, seededCourse }) => {
    await page.goto(`/courses/${seededCourse.courseCode}/settings/grading`)
    const nameInput = page.locator('input[placeholder="e.g. Homework"]').first()
    await nameInput.fill('E2E Category Alpha')
    await page.getByRole('button', { name: /^save grading settings$/i }).click()
    await expect(page.getByText(/grading settings saved/i)).toBeVisible({ timeout: 8000 })

    await page.reload()
    await expect(page.locator('input[placeholder="e.g. Homework"]').first()).toHaveValue(
      'E2E Category Alpha',
    )
  })

  test('enable SBG persists on the course record', async ({ coursePage: page, seededCourse }) => {
    await page.goto(`/courses/${seededCourse.courseCode}/settings/grading`)

    await page.getByRole('checkbox', { name: /enable standards-based grading/i }).click()
    await page.getByRole('button', { name: /^save grading settings$/i }).click()
    await expect(page.getByText(/grading settings saved/i)).toBeVisible({ timeout: 8000 })

    const g = await apiGetCourseGrading(seededCourse.instructorToken, seededCourse.courseCode)
    expect(g.sbgEnabled).toBe(true)
  })
})
