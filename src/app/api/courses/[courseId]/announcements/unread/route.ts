import { RequestParams } from "@/models/request.model"
import { getUnreadAnnouncements } from "@/server/services/announcement.service"
import {
  getUserId,
  success,
  unauthorized,
} from "@/server/services/request.service"
import { NextRequest } from "next/server"

export const GET = async (
  req: NextRequest,
  { params }: RequestParams<{ courseId: string }>
) => {
  const userId = getUserId(req)
  if (!userId) return unauthorized()

  const onlyCount = req.nextUrl.searchParams.get("onlyCount") === "true"
  const { courseId } = await params
  const announcments = await getUnreadAnnouncements(courseId, userId, onlyCount)

  return success(announcments)
}
