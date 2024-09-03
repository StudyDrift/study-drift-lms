import { generatePermission, PermissionAction } from "./permissions.model"

const APP = "courses"

export const PERMISSION_COURSES_CREATE = generatePermission({
  app: APP,
  action: PermissionAction.Create,
})
