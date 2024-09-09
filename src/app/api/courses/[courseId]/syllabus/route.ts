import { PERMISSION_COURSE_SYLLABUS_UPDATE } from "@/models/permissions/course.permission"
import { RequestParams } from "@/models/request.model"
import { UpdateSyllabusPayload } from "@/models/syllabus.model"
import {
  getUserId,
  success,
  toJson,
  unauthorized,
  withPermission,
} from "@/server/services/request.service"
import {
  getSyllabusByCourseId,
  updateSyllabus,
} from "@/server/services/syllabus.service"
import { NextRequest } from "next/server"

export const GET = async (
  req: NextRequest,
  { params }: RequestParams<{ courseId: string }>
) => {
  const syllabus = await getSyllabusByCourseId(params.courseId)
  return success(syllabus)
}

export const PATCH = withPermission(
  PERMISSION_COURSE_SYLLABUS_UPDATE,
  async (req: NextRequest, { params }: RequestParams<{ courseId: string }>) => {
    const userId = getUserId(req)
    if (!userId) return unauthorized()
    const payload = await toJson<UpdateSyllabusPayload>(req)
    const syllabus = await updateSyllabus(
      {
        ...payload,
        courseId: params.courseId,
      },
      userId
    )
    return success(syllabus)
  }
)
