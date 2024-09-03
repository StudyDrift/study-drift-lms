import { CourseSettings } from "./course.model"

// An instance of a course for a term
export interface Section {
  id: string
  name: string
  meta: Record<string, any>
  settings: CourseSettings

  courseId: string
  termId: string
}
