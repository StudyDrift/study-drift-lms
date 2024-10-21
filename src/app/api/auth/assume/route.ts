import { PERMISSION_COURSE_IMPERSONATE_VIEW } from "@/models/permissions/course.permission"
import { createToken } from "@/server/services/auth/password.auth.service"
import {
  failure,
  getUserId,
  redirect,
  withPermission,
} from "@/server/services/request.service"
import { getUser } from "@/server/services/user.service"
import { NextRequest } from "next/server"

export const GET = withPermission(
  PERMISSION_COURSE_IMPERSONATE_VIEW,
  async (req: NextRequest) => {
    const role = req.nextUrl.searchParams.get("role")
    const callback =
      req.nextUrl.origin + req.nextUrl.searchParams.get("callback")

    const userId = getUserId(req)
    if (!userId) return failure("User not found")

    const user = await getUser(userId)

    if (!user) return failure("User not found")

    user.role = role ?? "student"

    const token = await createToken(user!)
    const res = redirect(callback)

    res.headers.set("location", callback ?? "/")

    res.cookies.set("auth", token, {
      path: "/",
      expires: new Date(Date.now() + 1000 * 60 * 60 * 12),
      secure: true,
      httpOnly: true,
    })

    return res
  }
)
