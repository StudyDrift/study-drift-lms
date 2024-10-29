"use client"
import { CalendarSelector } from "@/components/calendar/selector"
import { RootPage } from "@/components/root-page"
import { useGetCalendarEventsQuery } from "@/redux/services/calendar.api"
import { useState } from "react"

export default function Page() {
  const { data: events, isLoading: isEventsLoading } =
    useGetCalendarEventsQuery()

  const [selectedDay, setSelectedDay] = useState(new Date().getDate())

  return (
    <RootPage title="Calendar">
      <CalendarSelector
        selectedDay={selectedDay}
        onSelectedDayChange={setSelectedDay}
        events={events}
      />
    </RootPage>
  )
}
