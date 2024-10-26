import { CalendarEvent, CalendarEventsResponse } from "@/models/calendar.model"
import { getContentItemWithDueDate } from "./content-item.service"
import { getCourseByIds } from "./course.service"
import { getEnrollmentsByUserId } from "./enrollment.service"

export const getCalendarEvents = async (userId: string) => {
  const results: CalendarEvent[] = []

  const enrollments = await getEnrollmentsByUserId(userId)

  const courses = await getCourseByIds(enrollments.map((e) => e.courseId))

  for (const enrollment of enrollments) {
    const items = await getContentItemWithDueDate(enrollment.courseId)
    const course = courses.find((c) => c.id === enrollment.courseId)

    for (const item of items) {
      const event: CalendarEvent = {
        id: item.id,
        title: item.name,
        date: item.settings.dates.due,
        course: {
          id: enrollment.courseId,
          name: course?.name || "",
        },
        url: `/courses/${enrollment.courseId}/content/${item.id}`,
      }
      results.push(event)
    }
  }

  /**
   * {
   *   'yyyy-mm-dd': CalendarEvent[]
   * }
   */
  const eventsByDate = results.reduce((acc, event) => {
    const date = event.date || ""
    if (!date) return acc

    const [year, month, day] = date.split("-")
    const formattedDate = `${year}-${month}-${day}`

    if (!acc[formattedDate]) {
      acc[formattedDate] = []
    }
    acc[formattedDate].push(event)
    return acc
  }, {} as CalendarEventsResponse)

  return eventsByDate
}
