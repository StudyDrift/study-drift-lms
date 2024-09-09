export interface Syllabus {
  id: string
  body: string

  createdAt: Date
  updatedAt: Date

  courseId: string
}

export type UpdateSyllabusPayload = Pick<Syllabus, "body" | "courseId">
