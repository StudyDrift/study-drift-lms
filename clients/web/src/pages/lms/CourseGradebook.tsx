import { Navigate, useParams } from 'react-router-dom'
import { usePermissions } from '../../context/usePermissions'
import { courseGradebookViewPermission } from '../../lib/coursesApi'
import { GradebookGrid } from './gradebook/GradebookGrid'
import { initialMockGrades, mockAssignments, mockStudents } from './gradebook/mockGradebookData'
import { LmsPage } from './LmsPage'

export default function CourseGradebook() {
  const { courseCode } = useParams<{ courseCode: string }>()
  const { allows, loading } = usePermissions()

  if (!courseCode) {
    return <Navigate to="/courses" replace />
  }

  if (loading) {
    return null
  }

  if (!allows(courseGradebookViewPermission(courseCode))) {
    return <Navigate to={`/courses/${encodeURIComponent(courseCode)}`} replace />
  }

  return (
    <LmsPage
      title="Gradebook"
      description="Spreadsheet-style grades (mock data — not saved). Use the arrows, Tab, Enter, and double-click to edit cells."
    >
      <GradebookGrid
        assignments={mockAssignments}
        students={mockStudents}
        initialGrades={initialMockGrades}
      />
    </LmsPage>
  )
}
