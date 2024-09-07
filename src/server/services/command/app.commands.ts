import { Command } from "@/models/command.model"
import { PERMISSION_APPS_SETTINGS_VIEW } from "@/models/permissions/app.permission"
import { nanoid } from "nanoid"

export const APPS: Command[] = [
  {
    id: nanoid(),
    name: "Dashboard",
    group: "Apps",
    actionType: "link",
    action: "/dashboard",
    icon: "LayoutDashboardIcon",
  },
  {
    id: nanoid(),
    name: "Courses",
    group: "Apps",
    actionType: "link",
    action: "/courses",
    icon: "School2Icon",
  },
  {
    id: nanoid(),
    name: "Calendar",
    group: "Apps",
    actionType: "link",
    action: "/calendar",
    icon: "Calendar",
  },
  {
    id: nanoid(),
    name: "Assignments",
    group: "Apps",
    actionType: "link",
    action: "/assignments",
    icon: "ListCheckIcon",
  },
  {
    id: nanoid(),
    name: "Roles & Permissions",
    group: "System Settings",
    actionType: "link",
    action: "/system/roles-and-permissions",
    icon: "LockClosedIcon",
    permission: PERMISSION_APPS_SETTINGS_VIEW,
  },
]
