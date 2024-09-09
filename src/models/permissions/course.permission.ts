import { generatePermission, PermissionAction } from "./permissions.model"

const APP = "course"
enum Resources {
  Gradebook = "gradebook",
  Settings = "settings",
  Content = "content",
  Announcements = "announcements",
  Outcomes = "outcomes",
}

export const PERMISSION_COURSE_GRADEBOOK_VIEW = generatePermission({
  service: APP,
  resource: Resources.Gradebook,
  action: PermissionAction.View,
})

export const PERMISSION_COURSE_SETTINGS_VIEW = generatePermission({
  service: APP,
  resource: Resources.Settings,
  action: PermissionAction.View,
})

export const PERMISSION_COURSE_CONTENT_CREATE = generatePermission({
  service: APP,
  resource: Resources.Content,
  action: PermissionAction.Create,
})

export const PERMISSION_COURSE_CONTENT_UPDATE = generatePermission({
  service: APP,
  resource: Resources.Content,
  action: PermissionAction.Update,
})

export const PERMISSION_COURSE_CONTENT_DELETE = generatePermission({
  service: APP,
  resource: Resources.Content,
  action: PermissionAction.Delete,
})

export const PERMISSION_COURSE_ANNOUNCEMENTS_CREATE = generatePermission({
  service: APP,
  resource: Resources.Announcements,
  action: PermissionAction.Create,
})

export const PERMISSION_COURSE_ANNOUNCEMENTS_DELETE = generatePermission({
  service: APP,
  resource: Resources.Announcements,
  action: PermissionAction.Delete,
})

export const PERMISSION_COURSE_OUTCOMES_CREATE = generatePermission({
  service: APP,
  resource: Resources.Outcomes,
  action: PermissionAction.Create,
})
