import { CreateContentItemPayload } from "@/models/content.model"
import { PERMISSION_COURSE_CONTENT_CREATE } from "@/models/permissions/course.permission"
import { createContentItem } from "@/server/services/content-item.service"
import {
  getUserId,
  success,
  toJson,
  unauthorized,
  withPermission,
} from "@/server/services/request.service"
import { NextRequest } from "next/server"

export const POST = withPermission(
  PERMISSION_COURSE_CONTENT_CREATE,
  async (req: NextRequest) => {
    const body = await toJson<CreateContentItemPayload>(req)
    const userId = getUserId(req)
    if (!userId) return unauthorized()
    const contentItem = await createContentItem(body, userId)
    return success(contentItem)
  }
)
