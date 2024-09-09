import { CreateAnnouncementPayload } from "@/models/announcement.model"
import { PERMISSION_COURSE_ANNOUNCEMENTS_CREATE } from "@/models/permissions/course.permission"
import { RequestParams } from "@/models/request.model"
import {
  createAnnouncement,
  getCourseAnnouncements,
} from "@/server/services/announcement.service"
import {
  getUserId,
  success,
  toJson,
  unauthorized,
  withPermission,
} from "@/server/services/request.service"
import { NextRequest } from "next/server"

export const POST = withPermission(
  PERMISSION_COURSE_ANNOUNCEMENTS_CREATE,
  async (req: NextRequest, { params }: RequestParams<{ courseId: string }>) => {
    const body = await toJson<CreateAnnouncementPayload>(req)
    const userId = getUserId(req)
    if (!userId) return unauthorized()
    const announcement = await createAnnouncement(body, userId, params.courseId)
    return success(announcement)
  }
)

export const GET = async (
  req: NextRequest,
  { params }: RequestParams<{ courseId: string }>
) => {
  const userId = getUserId(req)
  if (!userId) return unauthorized()
  const announcements = await getCourseAnnouncements(params.courseId, userId)
  return success(announcements)
}
