"use client"
import { useGetCourseByIdQuery } from "@/redux/services/course.api"
import { useParams } from "next/navigation"

export const useCourseData = () => {
  const { courseId } = useParams<{ courseId: string }>()
  const { data: course, isLoading: isCourseLoading } = useGetCourseByIdQuery(
    courseId,
    { skip: !courseId }
  )

  return { course, isLoading: isCourseLoading }
}
