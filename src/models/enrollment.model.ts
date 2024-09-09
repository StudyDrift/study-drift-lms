import { CommonDates } from "./dates.model"
import { User } from "./user.model"

// An instance of a sections, progress, and outcome achievements
export interface Enrollment {
  id: string
  userId: string
  courseId: string
  sectionId?: string
  role: EnrollmentRole
  meta: Record<string, any>
  dates: Pick<CommonDates, "start" | "end">

  user?: Pick<User, "id" | "first" | "last" | "email">
}

export enum EnrollmentRole {
  student = "student",
  teacher = "teacher",
  admin = "admin",
  owner = "owner",
}

export type EnrollmentCreatePayload = Omit<Enrollment, "id">
