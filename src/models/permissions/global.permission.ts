import { generatePermission, PermissionAction } from "./permissions.model"

const APP = "global"

enum Resources {
  Roles = "roles",
}

export const PERMISSION_GLOBAL_ALL_ROLES_VIEW = generatePermission({
  service: APP,
  resource: Resources.Roles,
  action: PermissionAction.Create,
})
