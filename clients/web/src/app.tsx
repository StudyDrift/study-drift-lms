import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { RequireAuth } from './auth/require-auth'
import { ApiErrorBoundary } from './components/api-error-boundary'
import { AppShell } from './components/layout/app-shell'
import Calendar from './pages/lms/calendar'
import CourseCalendarPage from './pages/lms/course-calendar-page'
import CourseEnrollments from './pages/lms/course-enrollments'
import CourseFeedPage from './pages/lms/course-feed-page'
import CourseGradebook from './pages/lms/course-gradebook'
import CourseMyGrades from './pages/lms/course-my-grades'
import AdminAccommodationsPage from './pages/lms/admin-accommodations-page'
import CourseCreate from './pages/lms/course-create'
import CourseDetail from './pages/lms/course-detail'
import CourseLayout from './pages/lms/course-layout'
import CourseModuleAssignmentPage from './pages/lms/course-module-assignment-page'
import CourseModuleContentPage from './pages/lms/course-module-content-page'
import CourseModuleExternalLinkPage from './pages/lms/course-module-external-link-page'
import CourseModuleQuizPage from './pages/lms/course-module-quiz-page'
import { CourseQuestionBankPage } from './pages/lms/course-question-bank-page'
import CourseModules from './pages/lms/course-modules'
import CourseNotebookPage from './pages/lms/course-notebook-page'
import CourseSettings from './pages/lms/course-settings'
import CourseSyllabus from './pages/lms/course-syllabus'
import Courses from './pages/lms/courses'
import Dashboard from './pages/lms/dashboard'
import Inbox from './pages/lms/inbox'
import MyNotebooksPage from './pages/lms/my-notebooks-page'
import Reports from './pages/lms/reports'
import Settings from './pages/lms/settings'
import ForgotPassword from './pages/forgot-password'
import Login from './pages/login'
import PrivacyPolicyPage from './pages/privacy-policy-page'
import ResetPassword from './pages/reset-password'
import Signup from './pages/signup'
import TermsOfUsePage from './pages/terms-of-use-page'

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
        <Route
          element={
            <ApiErrorBoundary>
              <AppShell />
            </ApiErrorBoundary>
          }
        >
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
