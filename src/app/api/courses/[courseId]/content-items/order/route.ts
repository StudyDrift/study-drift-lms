import { RequestParams } from "@/models/request.model"
import { updateContentItemOrder } from "@/server/services/content-item.service"
import { failure, success, toJson } from "@/server/services/request.service"
import { NextRequest } from "next/server"

export const PATCH = async (
  req: NextRequest,
  { params }: RequestParams<{ courseId: string }>
) => {
  const body = await toJson<string[]>(req)
  const courseId = params.courseId
  if (!courseId) return failure("Missing course id")
  await updateContentItemOrder(courseId, body)
  return success({ success: true })
}
