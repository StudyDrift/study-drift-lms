import { describe, expect, it } from 'vitest'
import {
  courseEnrollmentsReadPermission,
  courseGradebookViewPermission,
  courseItemCreatePermission,
  courseItemsCreatePermission,
  viewerIsLearnerOnlyCourseEnrollment,
  viewerShouldHideCourseEnrollmentsNav,
  viewerShouldShowMyGradesNav,
} from './coursesApi'

describe('courseItemCreatePermission', () => {
  it('builds the server-aligned permission string from course code', () => {
    expect(courseItemCreatePermission('C-ABC123')).toBe('course:C-ABC123:item:create')
  })
})

describe('courseItemsCreatePermission', () => {
  it('builds the server-aligned permission string from course code', () => {
    expect(courseItemsCreatePermission('C-ABC123')).toBe('course:C-ABC123:items:create')
  })
})

describe('courseGradebookViewPermission', () => {
  it('builds the server-aligned permission string from course code', () => {
    expect(courseGradebookViewPermission('C-ABC123')).toBe('course:C-ABC123:gradebook:view')
  })
})

describe('courseEnrollmentsReadPermission', () => {
  it('builds the server-aligned permission string from course code', () => {
    expect(courseEnrollmentsReadPermission('C-ABC123')).toBe('course:C-ABC123:enrollments:read')
  })
})

describe('viewerIsLearnerOnlyCourseEnrollment', () => {
  it('is true for student without staff enrollment (case-insensitive)', () => {
    expect(viewerIsLearnerOnlyCourseEnrollment(['student'])).toBe(true)
    expect(viewerIsLearnerOnlyCourseEnrollment(['Student'])).toBe(true)
    expect(viewerIsLearnerOnlyCourseEnrollment([])).toBe(true)
    expect(viewerIsLearnerOnlyCourseEnrollment(null)).toBe(true)
  })

  it('is false when staff enrollment exists, including alongside student', () => {
    expect(viewerIsLearnerOnlyCourseEnrollment(['student', 'teacher'])).toBe(false)
    expect(viewerIsLearnerOnlyCourseEnrollment(['Teacher', 'student'])).toBe(false)
    expect(viewerIsLearnerOnlyCourseEnrollment(['instructor'])).toBe(false)
    expect(viewerIsLearnerOnlyCourseEnrollment(['ta'])).toBe(false)
    expect(viewerIsLearnerOnlyCourseEnrollment(['teacher'])).toBe(false)
  })
})

describe('viewerShouldHideCourseEnrollmentsNav', () => {
  it('hides when previewing as student even with staff enrollment', () => {
    expect(viewerShouldHideCourseEnrollmentsNav(['teacher', 'student'], 'student')).toBe(true)
  })

  it('hides for learner-only when previewing as teacher', () => {
    expect(viewerShouldHideCourseEnrollmentsNav(['student'], 'teacher')).toBe(true)
  })

  it('does not hide for staff-only enrollment in teacher preview', () => {
    expect(viewerShouldHideCourseEnrollmentsNav(['teacher'], 'teacher')).toBe(false)
    expect(viewerShouldHideCourseEnrollmentsNav(['student', 'teacher'], 'teacher')).toBe(false)
  })
})

describe('viewerShouldShowMyGradesNav', () => {
  it('shows in student preview even when enrolled as staff', () => {
    expect(viewerShouldShowMyGradesNav(['student', 'teacher'], 'student')).toBe(true)
    expect(viewerShouldShowMyGradesNav(['teacher'], 'student')).toBe(true)
  })

  it('hides in teacher preview when staff is enrolled (including dual student+teacher)', () => {
    expect(viewerShouldShowMyGradesNav(['student', 'teacher'], 'teacher')).toBe(false)
    expect(viewerShouldShowMyGradesNav(['teacher'], 'teacher')).toBe(false)
  })

  it('shows in teacher preview only for learner-only enrollment', () => {
    expect(viewerShouldShowMyGradesNav(['student'], 'teacher')).toBe(true)
    expect(viewerShouldShowMyGradesNav(['Student'], 'teacher')).toBe(true)
  })
})
