import { useEffect, useState } from 'react'
import { fetchCourse } from './coursesApi'
import { COURSE_VIEWER_ENROLLMENTS_CHANGED } from './courseViewAs'

/**
 * Loads `viewerEnrollmentRoles` for the course and refetches when enrollment
 * changes for the signed-in user (e.g. self-enroll as student) without a full page reload.
 */
export function useViewerEnrollmentRoles(courseCode: string | null | undefined): string[] | null {
  const [viewerRoles, setViewerRoles] = useState<string[] | null>(null)

  useEffect(() => {
    if (!courseCode) {
      setViewerRoles(null)
      return
    }
    let cancelled = false
    let gen = 0
    const run = () => {
      const id = ++gen
      void (async () => {
        try {
          const c = await fetchCourse(courseCode)
          if (cancelled || id !== gen) return
          setViewerRoles(c.viewerEnrollmentRoles ?? [])
        } catch {
          if (!cancelled && id === gen) setViewerRoles(null)
        }
      })()
    }
    run()
    function onEnrollmentChanged(e: Event) {
      const ce = e as CustomEvent<{ courseCode?: string }>
      if (ce.detail?.courseCode === courseCode) run()
    }
    window.addEventListener(COURSE_VIEWER_ENROLLMENTS_CHANGED, onEnrollmentChanged)
    return () => {
      cancelled = true
      window.removeEventListener(COURSE_VIEWER_ENROLLMENTS_CHANGED, onEnrollmentChanged)
    }
  }, [courseCode])

  return viewerRoles
}
