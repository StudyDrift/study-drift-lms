import { InstallAppPayload } from "@/models/version.model"
import { createPasswordAuthRecord } from "@/server/services/auth/password.auth.service"
import { installApp } from "@/server/services/install.service"
import { failure, success, toJson } from "@/server/services/request.service"
import { provisionUser } from "@/server/services/user.service"
import { NextRequest } from "next/server"

export const POST = async (req: NextRequest) => {
  const body = await toJson<InstallAppPayload>(req)

  if (!body) return failure("No payload found")

  if (!body.password || !body.first || !body.last || !body.email) {
    return failure("Invalid payload")
  }

  const user = await provisionUser({
    first: body.first,
    last: body.last,
    email: body.email,
  })

  if (!user) return failure("Failed to provision user")
  await createPasswordAuthRecord({
    userId: user.id,
    password: body.password,
    email: body.email,
  })

  const version = await installApp(user)

  return success(version)
}
