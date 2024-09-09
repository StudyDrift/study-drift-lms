"use client"
import { RootPage } from "@/components/root-page"
import { useCourseData } from "@/hooks/use-course-data.hooks"

export default function Page() {
  const { course, isLoading: isCourseLoading } = useCourseData()

  return (
    <RootPage title="Course" isLoading={isCourseLoading}>
      Welcome to the course
    </RootPage>
  )
}
