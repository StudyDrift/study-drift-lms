import { Permission } from "./permissions/permissions.model"

interface BaseCommand {
  id: string
  name: string
  hotkey?: string
  group: string
  icon?: string
  permission?: Permission
}

interface LinkCommand extends BaseCommand {
  actionType: "link"
  action: string
}

interface CallbackCommand extends BaseCommand {
  actionType: "callback"
  action: () => void
}

export type Command = LinkCommand | CallbackCommand

export interface CommandContextOption {
  courseId?: string
}
