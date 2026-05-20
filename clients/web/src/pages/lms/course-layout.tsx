import { Outlet, useParams } from 'react-router-dom'
import { TutorPanel } from '../../components/TutorPanel'
import { useCourseNavFeatures } from '../../context/course-nav-features-context'
import { CourseSyllabusAcceptanceOverlay } from './course-syllabus-acceptance-overlay'

/**
 * Wraps all routes under `/courses/:courseCode` so syllabus acceptance applies on first visit
 * to any course page, not only the overview.
 */
export default function CourseLayout() {
  const { courseCode } = useParams<{ courseCode: string }>()
  const { aiTutorEnabled } = useCourseNavFeatures()

  return (
    <>
      {courseCode ? <CourseSyllabusAcceptanceOverlay courseCode={courseCode} /> : null}
      <Outlet />
      {courseCode && aiTutorEnabled ? <TutorPanel courseCode={courseCode} /> : null}
    </>
  )
}
