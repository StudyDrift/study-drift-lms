import { updateModuleOrder } from "@/server/services/module.service"
import { failure, success, toJson } from "@/server/services/request.service"
import { NextRequest } from "next/server"

export const PATCH = async (req: NextRequest) => {
  const body = await toJson<string[]>(req)
  const courseId = req.nextUrl.pathname.split("/")[3]
  if (!courseId) return failure("Missing course id")
  await updateModuleOrder(courseId, body)
  return success({ success: true })
}
