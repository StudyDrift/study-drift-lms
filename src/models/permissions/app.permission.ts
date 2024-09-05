import { generatePermission, PermissionAction } from "./permissions.model"

const APP = "apps"
enum Resources {
  Settings = "settings",
}

export const PERMISSION_APPS_SETTINGS_VIEW = generatePermission({
  service: APP,
  resource: Resources.Settings,
  action: PermissionAction.View,
})
