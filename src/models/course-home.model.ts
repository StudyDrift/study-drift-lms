export interface CourseHome {
  courseId: string
  body: string
  meta: Record<string, any>
}

export type UpdateCourseHomePayload = Omit<CourseHome, "courseId">
