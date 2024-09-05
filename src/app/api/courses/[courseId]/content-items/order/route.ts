import { updateContentItemOrder } from "@/server/services/content-item.service"
import { failure, success, toJson } from "@/server/services/request.service"
import { NextRequest } from "next/server"

export const PATCH = async (req: NextRequest) => {
  const body = await toJson<string[]>(req)
  const courseId = req.nextUrl.pathname.split("/")[3]
  if (!courseId) return failure("Missing course id")
  await updateContentItemOrder(courseId, body)
  return success({ success: true })
}
