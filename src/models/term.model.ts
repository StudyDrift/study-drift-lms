import { CommonDates } from "./dates.model"

// Unit of time to isolate sections and enrollments
export interface Term {
  id: string
  name: string
  meta: Record<string, any>
  dates: Pick<CommonDates, "start" | "end">
}
