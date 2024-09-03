"use client"
import { useCourseData } from "@/hooks/use-course-data.hooks"
import { Spinner } from "@material-tailwind/react"
import { PropsWithChildren } from "react"

interface Props extends PropsWithChildren {}

export default function CourseLayout({ children }: Props) {
  const { isLoading } = useCourseData()

  if (isLoading) {
    return (
      <div className="flex justify-center items-center flex-col w-full">
        <Spinner />
        Course Loading...
      </div>
    )
  }

  return <>{children}</>
}
