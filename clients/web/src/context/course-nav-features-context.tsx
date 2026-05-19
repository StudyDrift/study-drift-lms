/* eslint-disable react-refresh/only-export-components -- context module exports provider + hooks */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { matchPath, useLocation } from 'react-router-dom'
import { fetchCourse } from '../lib/courses-api'

export type CourseNavFeatures = {
  notebookEnabled: boolean
  feedEnabled: boolean
  calendarEnabled: boolean
  questionBankEnabled: boolean
  standardsAlignmentEnabled: boolean
  discussionsEnabled: boolean
  /** Plan 6.5 — real-time collaborative documents. */
  collabDocsEnabled: boolean
  /** Plan 3.7 — standards-based grading enabled for the course. */
  sbgEnabled: boolean
  /** Plan 6.4 — virtual classroom / live sessions (default true). */
  liveSessionsEnabled: boolean
  /** Plan 6.6 — private group spaces (feed per enrollment group). */
  groupSpacesEnabled: boolean
  /** Plan 6.7 — office hours appointment scheduling. */
  officeHoursEnabled: boolean
  /** Plan 6.9 — conversational AI tutor side-panel. */
  aiTutorEnabled: boolean
  /** True while loading or re-fetching flags for the active course. */
  loading: boolean
  /** Re-load feature flags from the server (e.g. after saving settings). */
  refresh: () => Promise<void>
}

const defaultFeatures: CourseNavFeatures = {
  notebookEnabled: true,
  feedEnabled: true,
  calendarEnabled: true,
  questionBankEnabled: false,
  standardsAlignmentEnabled: false,
  discussionsEnabled: false,
  collabDocsEnabled: false,
  sbgEnabled: false,
  liveSessionsEnabled: true,
  groupSpacesEnabled: false,
  officeHoursEnabled: false,
  aiTutorEnabled: false,
  loading: false,
  refresh: async () => {},
}

const CourseNavFeaturesContext = createContext<CourseNavFeatures>(defaultFeatures)

export function CourseNavFeaturesProvider({ children }: { children: ReactNode }) {
  const location = useLocation()
  const m = matchPath({ path: '/courses/:courseCode/*', end: false }, location.pathname)
  const raw = m?.params.courseCode
  const courseCode = raw && raw !== 'create' ? raw : null

  const [notebookEnabled, setNotebookEnabled] = useState(true)
  const [feedEnabled, setFeedEnabled] = useState(true)
  const [calendarEnabled, setCalendarEnabled] = useState(true)
  const [questionBankEnabled, setQuestionBankEnabled] = useState(false)
  const [standardsAlignmentEnabled, setStandardsAlignmentEnabled] = useState(false)
  const [discussionsEnabled, setDiscussionsEnabled] = useState(false)
  const [collabDocsEnabled, setCollabDocsEnabled] = useState(false)
  const [sbgEnabled, setSbgEnabled] = useState(false)
  const [liveSessionsEnabled, setLiveSessionsEnabled] = useState(true)
  const [groupSpacesEnabled, setGroupSpacesEnabled] = useState(false)
  const [officeHoursEnabled, setOfficeHoursEnabled] = useState(false)
  const [aiTutorEnabled, setAiTutorEnabled] = useState(false)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!courseCode) {
      setNotebookEnabled(true)
      setFeedEnabled(true)
      setCalendarEnabled(true)
      setQuestionBankEnabled(false)
      setStandardsAlignmentEnabled(false)
      setDiscussionsEnabled(false)
      setCollabDocsEnabled(false)
      setSbgEnabled(false)
      setLiveSessionsEnabled(true)
      setGroupSpacesEnabled(false)
      setOfficeHoursEnabled(false)
      setAiTutorEnabled(false)
      return
    }
    setLoading(true)
    try {
      const c = await fetchCourse(courseCode)
      setNotebookEnabled(c.notebookEnabled !== false)
      setFeedEnabled(c.feedEnabled !== false)
      setCalendarEnabled(c.calendarEnabled !== false)
      setQuestionBankEnabled(c.questionBankEnabled === true)
      setStandardsAlignmentEnabled(c.standardsAlignmentEnabled === true)
      setDiscussionsEnabled(c.discussionsEnabled === true)
      setCollabDocsEnabled(c.collabDocsEnabled === true)
      setSbgEnabled(c.sbgEnabled === true)
      setLiveSessionsEnabled(c.liveSessionsEnabled !== false)
      setGroupSpacesEnabled(c.groupSpacesEnabled === true)
      setOfficeHoursEnabled(c.officeHoursEnabled === true)
      setAiTutorEnabled(c.aiTutorEnabled === true)
    } catch {
      setNotebookEnabled(true)
      setFeedEnabled(true)
      setCalendarEnabled(true)
      setQuestionBankEnabled(false)
      setStandardsAlignmentEnabled(false)
      setDiscussionsEnabled(false)
      setCollabDocsEnabled(false)
      setSbgEnabled(false)
      setLiveSessionsEnabled(true)
      setGroupSpacesEnabled(false)
      setOfficeHoursEnabled(false)
      setAiTutorEnabled(false)
    } finally {
      setLoading(false)
    }
  }, [courseCode])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const value = useMemo(
    () => ({
      notebookEnabled,
      feedEnabled,
      calendarEnabled,
      questionBankEnabled,
      standardsAlignmentEnabled,
      discussionsEnabled,
      collabDocsEnabled,
      sbgEnabled,
      liveSessionsEnabled,
      groupSpacesEnabled,
      officeHoursEnabled,
      aiTutorEnabled,
      loading,
      refresh,
    }),
    [
      notebookEnabled,
      feedEnabled,
      calendarEnabled,
      questionBankEnabled,
      standardsAlignmentEnabled,
      discussionsEnabled,
      collabDocsEnabled,
      sbgEnabled,
      liveSessionsEnabled,
      groupSpacesEnabled,
      officeHoursEnabled,
      aiTutorEnabled,
      loading,
      refresh,
    ],
  )

  return (
    <CourseNavFeaturesContext.Provider value={value}>{children}</CourseNavFeaturesContext.Provider>
  )
}

export function useCourseNavFeatures(): CourseNavFeatures {
  return useContext(CourseNavFeaturesContext)
}
