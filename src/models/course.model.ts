import { CommonDates } from "./dates.model"

export interface Course {
  id: string
  code: string
  name: string
  description: string
  meta: Record<string, any>
  settings: CourseSettings
  outcomeIds: string[]
}

export interface CourseSettings {
  branding?: string
  bannerUrl?: string
  dates: CommonDates
}

export type CourseCreatePayload = Omit<Course, "id">
