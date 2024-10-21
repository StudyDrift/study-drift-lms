import { generatePermission, PermissionAction } from "./permissions.model"

const APP = "course"
enum Resources {
  Gradebook = "gradebook",
  Settings = "settings",
  Content = "content",
  Announcements = "announcements",
  Outcomes = "outcomes",
  Syllabus = "syllabus",
  Enrollments = "enrollments",
  AI = "ai",
  Impersonate = "impersonate",
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

export const PERMISSION_COURSE_SYLLABUS_UPDATE = generatePermission({
  service: APP,
  resource: Resources.Syllabus,
  action: PermissionAction.Update,
})

export const PERMISSION_COURSE_ENROLLMENTS_VIEW = generatePermission({
  service: APP,
  resource: Resources.Enrollments,
  action: PermissionAction.View,
})

export const PERMISSION_COURSE_ENROLLMENTS_CREATE = generatePermission({
  service: APP,
  resource: Resources.Enrollments,
  action: PermissionAction.Create,
})

export const PERMISSION_COURSE_ENROLLMENTS_DELETE = generatePermission({
  service: APP,
  resource: Resources.Enrollments,
  action: PermissionAction.Delete,
})

export const PERMISSION_COURSE_AI_CREATE = generatePermission({
  service: APP,
  resource: Resources.AI,
  action: PermissionAction.Create,
})

export const PERMISSION_COURSE_IMPERSONATE_VIEW = generatePermission({
  service: APP,
  resource: Resources.Impersonate,
  action: PermissionAction.View,
})
