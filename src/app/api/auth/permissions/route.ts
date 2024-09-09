import { getUserPermissions } from "@/server/services/permission.service"
import {
  getUserId,
  success,
  unauthorized,
} from "@/server/services/request.service"
import { NextRequest } from "next/server"

export const GET = async (req: NextRequest) => {
  const userId = getUserId(req)
  if (!userId) return unauthorized()

  const courseId = req.nextUrl.searchParams.get("courseId")
  if (courseId) {
    const permissions = await getUserPermissions(userId, { courseId })
    return success(permissions)
  }

  const permissions = await getUserPermissions(userId, {})
  return success(permissions)
}
