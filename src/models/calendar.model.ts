export interface CalendarEvent {
  id: string
  title: string
  date: string | undefined
  course: {
    id: string
    name: string
  }
  url: string
}

// CalendarEventKey is 'yyyy-mm-dd'
export type CalendarEventKey = string
export type CalendarEventsResponse = Record<CalendarEventKey, CalendarEvent[]>
