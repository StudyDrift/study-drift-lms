import { generatePermission, PermissionAction } from "./permissions.model"

const APP = "course"
enum Resources {
  Gradebook = "gradebook",
  Settings = "settings",
  Content = "content",
}

export const PERMISSION_COURSE_GRADEBOOK_VIEW = generatePermission({
  app: APP,
  resource: Resources.Gradebook,
  action: PermissionAction.View,
})

export const PERMISSION_COURSE_SETTINGS_VIEW = generatePermission({
  app: APP,
  resource: Resources.Settings,
  action: PermissionAction.View,
})

export const PERMISSION_COURSE_CONTENT_CREATE = generatePermission({
  app: APP,
  resource: Resources.Content,
  action: PermissionAction.Create,
})
