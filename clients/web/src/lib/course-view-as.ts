import { useSyncExternalStore } from 'react'

const STORAGE_PREFIX = 'lextures:courseViewAs:'

function subscribeCourseViewAs(onStoreChange: () => void) {
  window.addEventListener('studydrift-course-view-as', onStoreChange)
  window.addEventListener('storage', onStoreChange)
  return () => {
    window.removeEventListener('studydrift-course-view-as', onStoreChange)
    window.removeEventListener('storage', onStoreChange)
  }
}

export function courseViewStorageKey(courseCode: string): string {
  return `${STORAGE_PREFIX}${courseCode}`
}

export function getCourseViewAs(courseCode: string): 'teacher' | 'student' {
  if (typeof localStorage === 'undefined') return 'teacher'
  const v = localStorage.getItem(courseViewStorageKey(courseCode))
  return v === 'student' ? 'student' : 'teacher'
}

export function setCourseViewAs(courseCode: string, view: 'teacher' | 'student') {
  localStorage.setItem(courseViewStorageKey(courseCode), view)
  window.dispatchEvent(new Event('studydrift-course-view-as'))
}

export function clearCourseViewAs(courseCode: string) {
  localStorage.removeItem(courseViewStorageKey(courseCode))
  window.dispatchEvent(new Event('studydrift-course-view-as'))
}

/** Fired when the signed-in user’s enrollments for a course change (e.g. self-enroll as student). */
export const COURSE_VIEWER_ENROLLMENTS_CHANGED = 'studydrift-course-viewer-enrollments-changed'

export function notifyCourseViewerEnrollmentChanged(courseCode: string): void {
  window.dispatchEvent(
    new CustomEvent(COURSE_VIEWER_ENROLLMENTS_CHANGED, { detail: { courseCode } }),
  )
}

/**
 * Re-renders when the user changes “View as” for this course (localStorage + custom event).
 * Use this instead of calling `getCourseViewAs` during render so React sees updates immediately.
 */
export function useCourseViewAs(courseCode: string | undefined): 'teacher' | 'student' {
  return useSyncExternalStore(
    subscribeCourseViewAs,
    () => (courseCode ? getCourseViewAs(courseCode) : 'teacher'),
    () => 'teacher',
  )
}
