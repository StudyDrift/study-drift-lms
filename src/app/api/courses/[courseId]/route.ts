import { getCourseById } from "@/server/services/course.service"
import { success } from "@/server/services/request.service"
import { NextRequest } from "next/server"

export const GET = async (req: NextRequest) => {
  const courseId = req.nextUrl.pathname.split("/").slice(3)
  const course = await getCourseById(courseId + "")

  return success(course)
}
