"use client"
import { RootPage } from "@/components/root-page"
import { useCourseData } from "@/hooks/use-course-data.hooks"

export default function Page() {
  const { course } = useCourseData()

  return <RootPage title="Course">Welcome to the course</RootPage>
}
