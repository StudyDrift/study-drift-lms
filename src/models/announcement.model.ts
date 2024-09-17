import { CommonDates } from "./dates.model"

export interface Announcement {
  id: string
  title: string
  content: string
  dates: Omit<CommonDates, "start" | "end">
  viewedByIds: string[]
  isViewed: boolean

  postedById: string
  courseId: string

  meta: Record<string, any>
}

export type CreateAnnouncementPayload = Omit<
  Announcement,
  "id" | "postedById" | "viewedByIds" | "isViewed"
>
