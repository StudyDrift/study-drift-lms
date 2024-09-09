import { UpdateContentModulePayload } from "@/models/content.model"
import {
  PERMISSION_COURSE_CONTENT_DELETE,
  PERMISSION_COURSE_CONTENT_UPDATE,
} from "@/models/permissions/course.permission"
import { RequestParams } from "@/models/request.model"
import {
  deleteModule,
  getModuleById,
  updateModule,
} from "@/server/services/module.service"
import {
  failure,
  getUserId,
  success,
  unauthorized,
  withPermission,
} from "@/server/services/request.service"
import { NextRequest } from "next/server"

export const DELETE = withPermission(
  PERMISSION_COURSE_CONTENT_DELETE,
  async (req: NextRequest, { params }: RequestParams<{ courseId: string }>) => {
    const courseId = params.courseId
    if (!courseId) return failure("Missing course id")

    const contentModuleId = req.nextUrl.pathname.split("/")[5]
    if (!contentModuleId) return failure("Missing content item id")

    const userId = getUserId(req)
    if (!userId) return unauthorized()

    await deleteModule(contentModuleId, userId)
    return success({ message: "Module deleted" })
  }
)

export const PATCH = withPermission(
  PERMISSION_COURSE_CONTENT_UPDATE,
  async (req: NextRequest, { params }: RequestParams<{ courseId: string }>) => {
    const courseId = params.courseId
    if (!courseId) return failure("Missing course id")

    const contentModuleId = req.nextUrl.pathname.split("/")[5]
    if (!contentModuleId) return failure("Missing content item id")

    const userId = getUserId(req)
    if (!userId) return unauthorized()

    const payload = (await req.json()) as UpdateContentModulePayload

    await updateModule(contentModuleId, payload, userId)
    const item = await getModuleById(contentModuleId)

    return success(item)
  }
)
