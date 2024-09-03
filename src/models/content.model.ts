import { CommonDates } from "./dates.model"

export interface ContentModule {
  id: string
  name: string
  description: string
  meta: Record<string, any>

  outcomeIds: string[]
  children?: ContentItem[]
  sectionId: string
}

export interface ContentItem {
  id: string
  name: string
  description: string
  body: string
  meta: Record<string, any>
  settings: ContentItemSettings

  contentTypeId: string
  contentModuleId: string
}

export interface ContentItemSettings {
  disableBanner?: boolean
  dates: CommonDates
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
