import { PasswordAuth } from "@/models/auth.model"
import {
  createToken,
  loginPasswordAuth,
} from "@/server/services/auth/password.auth.service"
import { failure, success, toJson } from "@/server/services/request.service"
import { getUserByEmail } from "@/server/services/user.service"
import { NextRequest } from "next/server"

export const POST = async (req: NextRequest) => {
  const body = await toJson<Omit<PasswordAuth, "id">>(req)
  const isSuccessful = await loginPasswordAuth(body)
  if (!isSuccessful) {
    const user = await getUserByEmail(body.email)

    if (!user) return failure("User not found")

    const token = await createToken(user!)
    const res = success({ user, token })

    res.cookies.set("auth", token, {
      path: "/",
      expires: new Date(Date.now() + 1000 * 60 * 60 * 12),
      secure: true,
      httpOnly: true,
    })

    return res
  } else {
    return failure(isSuccessful)
  }
}
