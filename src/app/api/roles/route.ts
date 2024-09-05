import { getAllRoles } from "@/server/services/permission.service"
import { success } from "@/server/services/request.service"
import { NextRequest } from "next/server"

export const GET = async (req: NextRequest) => {
  const roles = await getAllRoles()
  return success(roles)
}
