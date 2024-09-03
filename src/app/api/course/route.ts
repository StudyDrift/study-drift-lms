import { CourseCreatePayload } from "@/models/course.model"
import { createCourse, getCourseByIds } from "@/server/services/course.service"
import { getByUserId as getEnrollmentsByUserId } from "@/server/services/enrollment.service"
import {
  getUserId,
  success,
  toJson,
  unauthorized,
} from "@/server/services/request.service"
import { NextRequest } from "next/server"

export const GET = async (req: NextRequest) => {
  const userId = getUserId(req)
  if (!userId) return unauthorized()

  const enrollments = await getEnrollmentsByUserId(userId)
  const courses = await getCourseByIds(enrollments.map((e) => e.courseId))
  return success(courses)
}

export const POST = async (req: NextRequest) => {
  const body = await toJson<CourseCreatePayload>(req)
  const userId = getUserId(req)
  if (!userId) return unauthorized()

  const course = await createCourse(
    {
      name: body.name,
      code: body.code,
      description: body.description,
      meta: {},
      settings: {
        dates: {},
      },
      outcomeIds: body.outcomeIds || [],
    },
    userId
  )

  return success(course)
}
