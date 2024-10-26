interface Props {
  day: number
  selectedDay: number
  totalNotifications?: number
}

export const DayNotification = ({
  day,
  selectedDay,
  totalNotifications,
}: Props) => {
  if (!totalNotifications || totalNotifications === 0) return null

  return (
    <>
      <span className="flex h-3 w-3 absolute -top-1 -right-1">
        <span
          className={`absolute group-hover:opacity-75 opacity-0 inline-flex h-full w-full rounded-full bg-purple-400 ${
            day === selectedDay ? "opacity-100" : ""
          }`}
        ></span>
        <span
          className={`relative inline-flex rounded-full h-3 w-3 bg-purple-100 ${
            day === selectedDay ? "animate-pulse" : ""
          }`}
        ></span>
      </span>
    </>
  )
}
