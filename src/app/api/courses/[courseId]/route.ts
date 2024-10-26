import { RequestParams } from "@/models/request.model"
import { getCourseById } from "@/server/services/course.service"
import { success } from "@/server/services/request.service"
import { NextRequest } from "next/server"

export const GET = async (
  req: NextRequest,
  { params }: RequestParams<{ courseId: string }>
) => {
  const { courseId } = await params
  const course = await getCourseById(courseId)

  return success(course)
}
