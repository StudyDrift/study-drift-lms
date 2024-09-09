import { PERMISSION_GLOBAL_ALL_ROLES_VIEW } from "@/models/permissions/global.permission"
import { getAllRoles } from "@/server/services/permission.service"
import { success, withPermission } from "@/server/services/request.service"
import { NextRequest } from "next/server"

export const GET = withPermission(
  PERMISSION_GLOBAL_ALL_ROLES_VIEW,
  async (req: NextRequest) => {
    const roles = await getAllRoles()
    return success(roles)
  }
)
