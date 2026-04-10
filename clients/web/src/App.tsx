import { Navigate, Route, Routes } from 'react-router-dom'
import { RequireAuth } from './auth/RequireAuth'
import { AppShell } from './components/layout/AppShell'
import Calendar from './pages/lms/Calendar'
import CourseCalendarPage from './pages/lms/CourseCalendarPage'
import CourseEnrollments from './pages/lms/CourseEnrollments'
import CourseGradebook from './pages/lms/CourseGradebook'
import CourseCreate from './pages/lms/CourseCreate'
import CourseDetail from './pages/lms/CourseDetail'
import CourseLayout from './pages/lms/CourseLayout'
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
          <Route path="/courses/:courseCode" element={<CourseLayout />}>
            <Route path="settings/*" element={<CourseSettings />} />
            <Route path="syllabus" element={<CourseSyllabus />} />
            <Route path="modules/content/:itemId" element={<CourseModuleContentPage />} />
            <Route path="modules/assignment/:itemId" element={<CourseModuleAssignmentPage />} />
            <Route path="modules/quiz/:itemId" element={<CourseModuleQuizPage />} />
            <Route path="modules" element={<CourseModules />} />
            <Route path="calendar" element={<CourseCalendarPage />} />
            <Route path="gradebook" element={<CourseGradebook />} />
            <Route path="enrollments" element={<CourseEnrollments />} />
            <Route index element={<CourseDetail />} />
          </Route>
          <Route path="/calendar" element={<Calendar />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/inbox" element={<Inbox />} />
          <Route path="/settings" element={<Navigate to="/settings/ai/models" replace />} />
          <Route path="/settings/ai" element={<Navigate to="/settings/ai/models" replace />} />
          <Route path="/settings/ai/:aiSection" element={<Settings />} />
          <Route path="/settings/:tab" element={<Settings />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
