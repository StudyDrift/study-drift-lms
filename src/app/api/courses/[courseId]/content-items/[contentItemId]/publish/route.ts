import { publishContentItem } from "@/server/services/content-item.service"
import {
  failure,
  getUserId,
  success,
  toJson,
  unauthorized,
} from "@/server/services/request.service"
import { NextRequest } from "next/server"

export const PATCH = async (req: NextRequest) => {
  const body = await toJson<{ isPublished: boolean }>(req)
  if (!body) return failure("Missing body")
  const userId = getUserId(req)
  if (!userId) return unauthorized()
  const contentItemId = req.nextUrl.pathname.split("/")[5]
  if (!contentItemId) return failure("Missing content item id")
  await publishContentItem(contentItemId, body.isPublished, userId)

  return success({ success: true })
}
