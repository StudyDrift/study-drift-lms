import { CreateContentModulePayload } from "@/models/content.model"
import {
  createContentModule,
  getContentModulesByCourseId,
} from "@/server/services/content.service"
import {
  failure,
  getUserId,
  success,
  toJson,
  unauthorized,
} from "@/server/services/request.service"
import { NextRequest } from "next/server"

export const POST = async (req: NextRequest) => {
  const body = await toJson<CreateContentModulePayload>(req)
  const userId = getUserId(req)
  if (!userId) return unauthorized()
  const contentModule = await createContentModule(body, userId)
  return success(contentModule)
}

export const GET = async (req: NextRequest) => {
  const courseId = req.nextUrl.pathname.split("/")[3]
  if (!courseId) return failure("Missing course id")
  const contentModules = await getContentModulesByCourseId(courseId + "")
  return success(contentModules)
}
