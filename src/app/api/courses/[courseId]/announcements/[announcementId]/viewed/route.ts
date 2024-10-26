import { RequestParams } from "@/models/request.model"
import { setViewAnnouncement } from "@/server/services/announcement.service"
import {
  getUserId,
  success,
  unauthorized,
} from "@/server/services/request.service"
import { NextRequest } from "next/server"

export const POST = async (
  req: NextRequest,
  { params }: RequestParams<{ courseId: string; announcementId: string }>
) => {
  const userId = getUserId(req)
  if (!userId) return unauthorized()
  const { announcementId } = await params
  await setViewAnnouncement(announcementId, userId)
  return success({ success: true })
}
