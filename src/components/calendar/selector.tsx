import { CalendarEventsResponse } from "@/models/calendar.model"
import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/solid"
import { useState } from "react"
import { DayNotification } from "./day-notification"

interface Props {
  selectedDay: number
  onSelectedDayChange: (day: number) => void
  events?: CalendarEventsResponse
}

type Days = { day: string; date: number; month?: number; year?: number }

export const CalendarSelector = ({
  selectedDay,
  onSelectedDayChange,
  events,
}: Props) => {
  const getDaysForWeek = (date: Date) => {
    const days: Days[] = []

    // Find the start of the week (Sunday)
    const startOfWeek = new Date(date)
    startOfWeek.setDate(date.getDate() - date.getDay())

    // Loop through each day of the week starting from Sunday
    for (let i = 0; i < 7; i++) {
      const newDate = new Date(startOfWeek)
      newDate.setDate(startOfWeek.getDate() + i)
      days.push({
        day: newDate.toLocaleDateString("en-US", { weekday: "short" }),
        date: newDate.getDate(),
        month: newDate.getMonth(),
        year: newDate.getFullYear(),
      })
    }

    return days
  }

  const [date, setDate] = useState(new Date())
  const [weekDays, setWeekDays] = useState(getDaysForWeek(date))

  const countEvents = (day: Days) => {
    if (!events) return 0
    return events[`${day.year}-${day.month}-${day.date}`]?.length || 0
  }

  return (
    <div className="bg-white shadow-md rounded-lg overflow-x-scroll mx-auto py-4 px-2 mt-4">
      <h1 className="text-xl font-bold text-center mb-3">
        {date.toLocaleDateString("en-US", { month: "long" })}
      </h1>
      <div className="flex justify-start md:justify-center">
        {/* Arrow left */}
        <div
          className="flex items-center cursor-pointer mr-2 transition-all duration-300 hover:bg-purple-500 hover:shadow-lg hover-dark-shadow p-2 rounded-lg text-gray-900 hover:text-gray-100"
          onClick={() => {
            const newDate = new Date(date)
            newDate.setDate(newDate.getDate() - 7)
            setDate(newDate)
            setWeekDays(getDaysForWeek(newDate))
          }}
        >
          <ChevronLeftIcon className="h-6 w-6" />
        </div>

        {weekDays.map((day) => (
          <div
            className={`relative flex group hover:bg-purple-500 hover:shadow-lg hover-dark-shadow rounded-lg mx-1 transition-all duration-300 cursor-pointer justify-center w-16 ${
              day.date === selectedDay ? "bg-purple-600 text-white" : ""
            }`}
            key={day.day}
            onClick={() => {
              onSelectedDayChange(day.date)
            }}
          >
            <DayNotification
              day={day.date}
              selectedDay={selectedDay}
              totalNotifications={countEvents(day)}
            />

            <div className="flex items-center px-4 py-4">
              <div className="text-center">
                <p
                  className={`group-hover:text-gray-100 text-sm transition-all	duration-300 ${
                    day.date === selectedDay ? "text-gray-100" : "text-gray-900"
                  }`}
                >
                  {day.day}
                </p>
                <p
                  className={`group-hover:text-gray-100 mt-3 group-hover:font-bold transition-all duration-300 ${
                    day.date === selectedDay ? "text-gray-100" : "text-gray-900"
                  }`}
                >
                  {day.date}
                </p>
              </div>
            </div>
          </div>
        ))}
        <div
          className="flex items-center cursor-pointer mr-2 transition-all duration-300 hover:bg-purple-500 hover:shadow-lg hover-dark-shadow p-2 rounded-lg text-gray-900 hover:text-gray-100"
          onClick={() => {
            const newDate = new Date(date)
            newDate.setDate(newDate.getDate() + 7)
            setDate(newDate)
            setWeekDays(getDaysForWeek(newDate))
          }}
        >
          <ChevronRightIcon className="h-6 w-6" />
        </div>
      </div>
    </div>
  )
}
