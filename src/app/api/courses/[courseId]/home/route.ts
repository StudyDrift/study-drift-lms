import { UpdateCourseHomePayload } from "@/models/course-home.model"
import { PERMISSION_COURSE_CONTENT_UPDATE } from "@/models/permissions/course.permission"
import { RequestParams } from "@/models/request.model"
import {
  getCourseHome,
  updateCourseHome,
} from "@/server/services/course-home.service"
import {
  failure,
  getUserId,
  success,
  toJson,
  unauthorized,
  withPermission,
} from "@/server/services/request.service"
import { NextRequest } from "next/server"

export const GET = async (
  req: NextRequest,
  { params }: RequestParams<{ courseId: string }>
) => {
  const { courseId } = await params
  const home = await getCourseHome(courseId)
  return success(home)
}

export const POST = withPermission(
  PERMISSION_COURSE_CONTENT_UPDATE,
  async (req: NextRequest, { params }: RequestParams<{ courseId: string }>) => {
    const body = await toJson<UpdateCourseHomePayload>(req)
    const userId = getUserId(req)
    if (!userId) return unauthorized()
    const { courseId } = await params
    if (!courseId) return failure("Missing course id")
    await updateCourseHome(courseId, body, userId)
    return success({ success: true })
  }
)
