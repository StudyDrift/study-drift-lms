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
  /** Plan 3.7 — standards-based grading enabled for the course. */
  sbgEnabled: boolean
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
  sbgEnabled: false,
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
  const [sbgEnabled, setSbgEnabled] = useState(false)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!courseCode) {
      setNotebookEnabled(true)
      setFeedEnabled(true)
      setCalendarEnabled(true)
      setQuestionBankEnabled(false)
      setStandardsAlignmentEnabled(false)
      setSbgEnabled(false)
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
      setSbgEnabled(c.sbgEnabled === true)
    } catch {
      setNotebookEnabled(true)
      setFeedEnabled(true)
      setCalendarEnabled(true)
      setQuestionBankEnabled(false)
      setStandardsAlignmentEnabled(false)
      setSbgEnabled(false)
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
      sbgEnabled,
      loading,
      refresh,
    }),
    [
      notebookEnabled,
      feedEnabled,
      calendarEnabled,
      questionBankEnabled,
      standardsAlignmentEnabled,
      sbgEnabled,
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
