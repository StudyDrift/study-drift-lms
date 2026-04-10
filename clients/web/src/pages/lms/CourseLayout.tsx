import { Outlet, useParams } from 'react-router-dom'
import { CourseSyllabusAcceptanceOverlay } from './CourseSyllabusAcceptanceOverlay'

/**
 * Wraps all routes under `/courses/:courseCode` so syllabus acceptance applies on first visit
 * to any course page, not only the overview.
 */
export default function CourseLayout() {
  const { courseCode } = useParams<{ courseCode: string }>()

  return (
    <>
      {courseCode ? <CourseSyllabusAcceptanceOverlay courseCode={courseCode} /> : null}
      <Outlet />
    </>
  )
}
