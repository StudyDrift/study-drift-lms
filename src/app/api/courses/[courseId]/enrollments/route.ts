import { PERMISSION_COURSE_ENROLLMENTS_VIEW } from "@/models/permissions/course.permission"
import { getEnrollmentsByCourseId } from "@/server/services/enrollment.service"
import { success, withPermission } from "@/server/services/request.service"
import { getUsersByIds } from "@/server/services/user.service"

export const GET = withPermission(
  PERMISSION_COURSE_ENROLLMENTS_VIEW,
  async (req, { params }) => {
    const { courseId } = await params
    const enrollments = await getEnrollmentsByCourseId(courseId)
    const users = await getUsersByIds(enrollments.map((e) => e.userId))

    enrollments.forEach((e) => {
      const user = users.find((u) => u.id === e.userId)
      if (user) {
        e.user = {
          id: user.id,
          first: user.first,
          last: user.last,
          email: user.email,
        }
      }
    })

    return success(enrollments)
  }
)
