import { PERMISSION_COURSE_ENROLLMENTS_CREATE } from "@/models/permissions/course.permission"
import { RequestParams } from "@/models/request.model"
import { getEnrollmentByUserAndCourse } from "@/server/services/enrollment.service"
import { getMaxRoleLevels } from "@/server/services/permission.service"
import {
  getUserId,
  success,
  unauthorized,
  withPermission,
} from "@/server/services/request.service"

export const GET = withPermission(
  PERMISSION_COURSE_ENROLLMENTS_CREATE,
  async (req, { params }: RequestParams<{ courseId: string }>) => {
    const userId = getUserId(req)
    if (!userId) return unauthorized()

    const enrollment = await getEnrollmentByUserAndCourse(
      userId,
      params.courseId
    )

    if (!enrollment) return success([])

    const roles = await getMaxRoleLevels(enrollment.role, "course")

    return success(roles)
  }
)
