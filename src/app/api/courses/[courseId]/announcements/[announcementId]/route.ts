import { PERMISSION_COURSE_ANNOUNCEMENTS_DELETE } from "@/models/permissions/course.permission"
import { RequestParams } from "@/models/request.model"
import { deleteAnnouncement } from "@/server/services/announcement.service"
import {
  getUserId,
  success,
  unauthorized,
  withPermission,
} from "@/server/services/request.service"
import { NextRequest } from "next/server"

export const DELETE = withPermission(
  PERMISSION_COURSE_ANNOUNCEMENTS_DELETE,
  async (
    req: NextRequest,
    { params }: RequestParams<{ courseId: string; announcementId: string }>
  ) => {
    const userId = getUserId(req)
    if (!userId) return unauthorized()
    const { courseId, announcementId } = await params
    await deleteAnnouncement(courseId, announcementId)
    return success({ message: "Announcement deleted" })
  }
)
