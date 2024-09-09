import { PERMISSION_COURSE_ENROLLMENTS_VIEW } from "@/models/permissions/course.permission"
import { getEnrollmentsByCourseId } from "@/server/services/enrollment.service"
import { success, withPermission } from "@/server/services/request.service"

export const GET = withPermission(
  PERMISSION_COURSE_ENROLLMENTS_VIEW,
  async (req, { params }) => {
    const enrollments = await getEnrollmentsByCourseId(params.courseId)

    return success(enrollments)
  }
)
