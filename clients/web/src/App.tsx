import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { RequireAuth } from './auth/RequireAuth'
import { AppShell } from './components/layout/AppShell'
import Calendar from './pages/lms/Calendar'
import CourseCalendarPage from './pages/lms/CourseCalendarPage'
import CourseEnrollments from './pages/lms/CourseEnrollments'
import CourseFeedPage from './pages/lms/CourseFeedPage'
import CourseGradebook from './pages/lms/CourseGradebook'
import CourseMyGrades from './pages/lms/CourseMyGrades'
import AdminAccommodationsPage from './pages/lms/AdminAccommodationsPage'
import CourseCreate from './pages/lms/CourseCreate'
import CourseDetail from './pages/lms/CourseDetail'
import CourseLayout from './pages/lms/CourseLayout'
import CourseModuleAssignmentPage from './pages/lms/CourseModuleAssignmentPage'
import CourseModuleContentPage from './pages/lms/CourseModuleContentPage'
import CourseModuleExternalLinkPage from './pages/lms/CourseModuleExternalLinkPage'
import CourseModuleQuizPage from './pages/lms/CourseModuleQuizPage.tsx'
import { CourseQuestionBankPage } from './pages/lms/CourseQuestionBankPage'
import CourseModules from './pages/lms/CourseModules'
import CourseNotebookPage from './pages/lms/CourseNotebookPage'
import CourseSettings from './pages/lms/CourseSettings'
import CourseSyllabus from './pages/lms/CourseSyllabus'
import Courses from './pages/lms/Courses'
import Dashboard from './pages/lms/Dashboard'
import Inbox from './pages/lms/Inbox'
import MyNotebooksPage from './pages/lms/MyNotebooksPage'
import Reports from './pages/lms/Reports'
import Settings from './pages/lms/Settings'
import ForgotPassword from './pages/ForgotPassword'
import Login from './pages/Login'
import PrivacyPolicyPage from './pages/PrivacyPolicyPage'
import ResetPassword from './pages/ResetPassword'
import Signup from './pages/Signup'
import TermsOfUsePage from './pages/TermsOfUsePage'

export default function App() {
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    function onAuthRequired() {
      const from = `${location.pathname}${location.search}${location.hash}`
      if (
        location.pathname === '/login' ||
        location.pathname === '/signup' ||
        location.pathname === '/forgot-password' ||
        location.pathname === '/reset-password'
      ) {
        return
      }
      navigate('/login', { replace: true, state: { from } })
    }
    window.addEventListener('studydrift-auth-required', onAuthRequired)
    return () => {
      window.removeEventListener('studydrift-auth-required', onAuthRequired)
    }
  }, [location.hash, location.pathname, location.search, navigate])

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/courses" element={<Courses />} />
          <Route path="/notebooks" element={<MyNotebooksPage />} />
          <Route path="/courses/create" element={<CourseCreate />} />
          <Route path="/courses/:courseCode" element={<CourseLayout />}>
            <Route path="settings/*" element={<CourseSettings />} />
            <Route path="feed" element={<CourseFeedPage />} />
            <Route path="syllabus" element={<CourseSyllabus />} />
            <Route path="modules/content/:itemId" element={<CourseModuleContentPage />} />
            <Route path="modules/assignment/:itemId" element={<CourseModuleAssignmentPage />} />
            <Route path="modules/quiz/:itemId" element={<CourseModuleQuizPage />} />
            <Route path="modules/external-link/:itemId" element={<CourseModuleExternalLinkPage />} />
            <Route path="questions" element={<CourseQuestionBankPage />} />
            <Route path="modules" element={<CourseModules />} />
            <Route path="notebook" element={<CourseNotebookPage />} />
            <Route path="calendar" element={<CourseCalendarPage />} />
            <Route path="my-grades" element={<CourseMyGrades />} />
            <Route path="gradebook" element={<CourseGradebook />} />
            <Route path="enrollments" element={<CourseEnrollments />} />
            <Route index element={<CourseDetail />} />
          </Route>
          <Route path="/calendar" element={<Calendar />} />
          <Route path="/admin/accommodations" element={<AdminAccommodationsPage />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/inbox" element={<Inbox />} />
          <Route path="/settings" element={<Navigate to="/settings/account" replace />} />
          <Route path="/settings/ai" element={<Navigate to="/settings/ai/models" replace />} />
          <Route path="/settings/ai/:aiSection" element={<Settings />} />
          <Route path="/settings/:tab" element={<Settings />} />
          <Route path="/terms" element={<TermsOfUsePage />} />
          <Route path="/privacy" element={<PrivacyPolicyPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
