import { getCommands } from "@/server/services/command.service"
import {
  getUserId,
  success,
  unauthorized,
} from "@/server/services/request.service"
import { NextRequest } from "next/server"

export const GET = async (req: NextRequest) => {
  const courseId = req.nextUrl.searchParams.get("courseId")
  const userId = getUserId(req)
  if (!userId) return unauthorized()

  const commands = await getCommands(userId, {
    courseId: courseId || undefined,
  })
  return success(commands)
}
