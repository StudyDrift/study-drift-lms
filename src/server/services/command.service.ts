import { CommandContextOption } from "@/models/command.model"
import { Permission } from "@/models/permissions/permissions.model"
import { APPS } from "./command/app.commands"
import { getCoursesCommands } from "./command/courses.commands"
import { getUserPermissions } from "./permission.service"

export const getCommands = async (
  userId: string,
  options: CommandContextOption
) => {
  const userPermissions = await getUserPermissions(userId, options)

  const apps = APPS.filter((app) => !app.permission)

  const permissionApps = APPS.filter((app) => app.permission).filter((app) =>
    userPermissions.includes(app.permission as Permission)
  )

  const coursesCommands = await getCoursesCommands(userId, options)

  return [...apps, ...permissionApps, ...coursesCommands]
}
