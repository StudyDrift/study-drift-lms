import { Navigate, Route, Routes } from 'react-router-dom'
import { RequireAuth } from './auth/RequireAuth'
import { AppShell } from './components/layout/AppShell'
import Calendar from './pages/lms/Calendar'
import CourseCalendarPage from './pages/lms/CourseCalendarPage'
import CourseEnrollments from './pages/lms/CourseEnrollments'
import CourseGradebook from './pages/lms/CourseGradebook'
import CourseCreate from './pages/lms/CourseCreate'
import CourseDetail from './pages/lms/CourseDetail'
import CourseModuleAssignmentPage from './pages/lms/CourseModuleAssignmentPage'
import CourseModuleContentPage from './pages/lms/CourseModuleContentPage'
import CourseModuleQuizPage from './pages/lms/CourseModuleQuizPage.tsx'
import CourseModules from './pages/lms/CourseModules'
import CourseSettings from './pages/lms/CourseSettings'
import CourseSyllabus from './pages/lms/CourseSyllabus'
import Courses from './pages/lms/Courses'
import Dashboard from './pages/lms/Dashboard'
import Inbox from './pages/lms/Inbox'
import Reports from './pages/lms/Reports'
import Settings from './pages/lms/Settings'
import Login from './pages/Login'
import Signup from './pages/Signup'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/courses" element={<Courses />} />
          <Route path="/courses/create" element={<CourseCreate />} />
          <Route path="/courses/:courseCode/settings/*" element={<CourseSettings />} />
          <Route path="/courses/:courseCode/syllabus" element={<CourseSyllabus />} />
          <Route path="/courses/:courseCode/modules" element={<CourseModules />} />
          <Route
            path="/courses/:courseCode/modules/content/:itemId"
            element={<CourseModuleContentPage />}
          />
          <Route
            path="/courses/:courseCode/modules/assignment/:itemId"
            element={<CourseModuleAssignmentPage />}
          />
          <Route path="/courses/:courseCode/modules/quiz/:itemId" element={<CourseModuleQuizPage />} />
          <Route path="/courses/:courseCode/calendar" element={<CourseCalendarPage />} />
          <Route path="/courses/:courseCode/gradebook" element={<CourseGradebook />} />
          <Route path="/courses/:courseCode/enrollments" element={<CourseEnrollments />} />
          <Route path="/courses/:courseCode" element={<CourseDetail />} />
          <Route path="/calendar" element={<Calendar />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/inbox" element={<Inbox />} />
          <Route path="/settings" element={<Navigate to="/settings/ai" replace />} />
          <Route path="/settings/:tab" element={<Settings />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
