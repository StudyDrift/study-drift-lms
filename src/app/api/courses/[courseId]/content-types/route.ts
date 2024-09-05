import { getAllContentTypes } from "@/server/services/content-type.service"
import { success } from "@/server/services/request.service"
import { NextRequest } from "next/server"

export const GET = async (req: NextRequest) => {
  const contentTypes = await getAllContentTypes()
  return success(contentTypes)
}
