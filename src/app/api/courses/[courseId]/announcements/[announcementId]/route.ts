import { RequestParams } from "@/models/request.model"
import { deleteAnnouncement } from "@/server/services/announcement.service"
import {
  getUserId,
  success,
  unauthorized,
} from "@/server/services/request.service"
import { NextRequest } from "next/server"

export const DELETE = async (
  req: NextRequest,
  { params }: RequestParams<{ courseId: string; announcementId: string }>
) => {
  const userId = getUserId(req)
  if (!userId) return unauthorized()
  await deleteAnnouncement(params.courseId, params.announcementId)
  return success({ message: "Announcement deleted" })
}
