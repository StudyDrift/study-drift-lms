import {
  deleteContentItem,
  getContentItemById,
} from "@/server/services/content-item.service"
import {
  failure,
  getUserId,
  success,
  unauthorized,
} from "@/server/services/request.service"
import { NextRequest } from "next/server"

export const GET = async (req: NextRequest) => {
  const contentItemId = req.nextUrl.pathname.split("/")[5]
  if (!contentItemId) return failure("Missing content item id")

  const item = await getContentItemById(contentItemId)
  return success(item)
}

export const DELETE = async (req: NextRequest) => {
  const userId = getUserId(req)
  if (!userId) return unauthorized()
  const contentItemId = req.nextUrl.pathname.split("/")[5]
  if (!contentItemId) return failure("Missing content item id")

  await deleteContentItem(contentItemId, userId)
  return success({ message: "Content item deleted" })
}
