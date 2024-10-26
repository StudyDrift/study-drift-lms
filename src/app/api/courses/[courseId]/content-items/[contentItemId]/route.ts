import { UpdateContentItemPayload } from "@/models/content.model"
import {
  PERMISSION_COURSE_CONTENT_DELETE,
  PERMISSION_COURSE_CONTENT_UPDATE,
} from "@/models/permissions/course.permission"
import { RequestParams } from "@/models/request.model"
import {
  deleteContentItem,
  getContentItemById,
  updateContentItem,
} from "@/server/services/content-item.service"
import {
  failure,
  getUserId,
  success,
  unauthorized,
  withPermission,
} from "@/server/services/request.service"
import { NextRequest } from "next/server"

export const GET = async (
  req: NextRequest,
  { params }: RequestParams<{ courseId: string; contentItemId: string }>
) => {
  const { contentItemId } = await params
  if (!contentItemId) return failure("Missing content item id")

  const item = await getContentItemById(contentItemId)
  return success(item)
}

export const DELETE = withPermission(
  PERMISSION_COURSE_CONTENT_DELETE,
  async (
    req: NextRequest,
    { params }: RequestParams<{ courseId: string; contentItemId: string }>
  ) => {
    const userId = getUserId(req)
    if (!userId) return unauthorized()
    const { contentItemId } = await params
    if (!contentItemId) return failure("Missing content item id")

    await deleteContentItem(contentItemId, userId)
    return success({ message: "Content item deleted" })
  }
)

export const PATCH = withPermission(
  PERMISSION_COURSE_CONTENT_UPDATE,
  async (
    req: NextRequest,
    { params }: RequestParams<{ courseId: string; contentItemId: string }>
  ) => {
    const userId = getUserId(req)
    if (!userId) return unauthorized()
    const { contentItemId } = await params
    if (!contentItemId) return failure("Missing content item id")

    const body = (await req.json()) as UpdateContentItemPayload
    if (!body) return failure("Missing body")

    await updateContentItem(contentItemId, body, userId)

    const item = await getContentItemById(contentItemId)

    return success(item)
  }
)
