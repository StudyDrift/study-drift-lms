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
  student = "Student",
  teacher = "Teacher",
  admin = "Admin",
  owner = "Owner",
}

export type EnrollmentCreatePayload = Omit<Enrollment, "id">
