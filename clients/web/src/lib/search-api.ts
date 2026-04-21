import { authorizedFetch } from './api'
import { readApiErrorMessage } from './errors'

export type SearchCourseItem = {
  courseCode: string
  title: string
  /** When false, course feed is hidden from search and nav. */
  notebookEnabled?: boolean
  feedEnabled?: boolean
  calendarEnabled?: boolean
  questionBankEnabled?: boolean
  standardsAlignmentEnabled?: boolean
}

export type SearchPersonItem = {
  userId: string
  email: string
  displayName: string | null
  role: string
  courseCode: string
  courseTitle: string
}

export type SearchIndexResponse = {
  courses: SearchCourseItem[]
  people: SearchPersonItem[]
}

async function parseJson(res: Response): Promise<unknown> {
  return res.json().catch(() => ({}))
}

/** Courses and people visible to the signed-in user (same access rules as the LMS). */
export async function fetchSearchIndex(): Promise<SearchIndexResponse> {
  const res = await authorizedFetch('/api/v1/search')
  const raw = await parseJson(res)
  if (!res.ok) throw new Error(readApiErrorMessage(raw))
  return raw as SearchIndexResponse
}
