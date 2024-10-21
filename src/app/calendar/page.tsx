"use client"
import { RootPage } from "@/components/root-page"
import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/solid"
import { useState } from "react"

export default function Page() {
  const getDaysForWeek = (date: Date) => {
    const days: { day: string; date: number; month?: number }[] = []
    for (let i = 0; i < 7; i++) {
      const newDate = new Date(date)
      newDate.setDate(newDate.getDate() + i)
      days.push({
        day: newDate.toLocaleDateString("en-US", { weekday: "short" }),
        date: newDate.getDate(),
        month: newDate.getMonth(),
      })
    }
    return days
  }

  const [date, setDate] = useState(new Date())
  const [weekDays, setWeekDays] = useState(getDaysForWeek(date))
  const currentDay = new Date().getDate()

  return (
    <RootPage title="Calendar">
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
                day.date === currentDay ? "bg-purple-600 text-white" : ""
              }`}
              key={day.day}
            >
              {day.date === currentDay && (
                <span className="flex h-3 w-3 absolute -top-1 -right-1">
                  <span className="animate-ping absolute group-hover:opacity-75 opacity-0 inline-flex h-full w-full rounded-full bg-purple-400 "></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-purple-100"></span>
                </span>
              )}
              <div className="flex items-center px-4 py-4">
                <div className="text-center">
                  <p
                    className={`group-hover:text-gray-100 text-sm transition-all	duration-300 ${
                      day.date === currentDay
                        ? "text-gray-100"
                        : "text-gray-900"
                    }`}
                  >
                    {day.day}
                  </p>
                  <p
                    className={`group-hover:text-gray-100 mt-3 group-hover:font-bold transition-all duration-300 ${
                      day.date === currentDay
                        ? "text-gray-100"
                        : "text-gray-900"
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
    </RootPage>
  )
}
