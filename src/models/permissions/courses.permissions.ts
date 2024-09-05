import { generatePermission, PermissionAction } from "./permissions.model"

const APP = "courses"

export const PERMISSION_COURSES_CREATE = generatePermission({
  service: APP,
  action: PermissionAction.Create,
})
