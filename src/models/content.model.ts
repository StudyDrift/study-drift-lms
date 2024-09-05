import { CommonDates } from "./dates.model"

export interface ContentModule {
  id: string
  name: string
  description: string
  meta: Record<string, any>
  order?: number

  outcomeIds: string[]
  children?: ContentItem[]
  courseId: string
}

export type CreateContentModulePayload = Omit<ContentModule, "id">
export type UpdateContentModulePayload = Omit<
  ContentModule,
  "id" | "children" | "courseId"
>

export interface ContentItem {
  id: string
  name: string
  description: string
  body: string
  meta: Record<string, any>
  settings: ContentItemSettings
  order?: number

  contentTypeId: string
  contentModuleId: string
  courseId: string
}

export type CreateContentItemPayload = Omit<ContentItem, "id">

export interface ContentItemSettings {
  disableBanner?: boolean
  dates: CommonDates
  isPublished?: boolean
}

export interface ContentType {
  id: string
  name: string
  description: string
  icon: string
  meta: Record<string, any>
}

export interface ContentItemInstance {
  id: string
  isComplete: boolean
  score?: number
  dates: Pick<CommonDates, "start" | "end">

  outcomeAchievements?: Record<string, number>

  contentItemId: string
  enrollmentId: string
}

export interface ContentModuleInstance {
  id: string
  isComplete: boolean
  score?: number
  dates: Pick<CommonDates, "start" | "end">

  outcomeAchievements?: Record<string, number>

  contentModuleId: string
  enrollmentId: string
}
