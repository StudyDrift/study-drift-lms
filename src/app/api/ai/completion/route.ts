import { ChatSession } from "@/models/ai.model"
import { PERMISSION_COURSE_AI_CREATE } from "@/models/permissions/course.permission"
import { getCompletion, updateSession } from "@/server/services/ai.service"
import {
  failure,
  success,
  toJson,
  withPermission,
} from "@/server/services/request.service"
import { NextRequest } from "next/server"

export const POST = withPermission(
  PERMISSION_COURSE_AI_CREATE,
  async (req: NextRequest) => {
    const session = await toJson<ChatSession>(req)

    const completion = await getCompletion(session.messages, session.context)
    if (!completion) return failure("Failed to get completion")

    session.messages.push({ role: "assistant", content: completion })

    await updateSession(session)

    return success(session)
  }
)
