export enum PermissionAction {
  Create = "Create",
  Read = "Read",
  Update = "Update",
  Delete = "Delete",
  View = "View",
}

export interface PermissionOptions {
  app: string
  resource?: string
  action: PermissionAction
}

export const generatePermission = (options: PermissionOptions): Permission => {
  const { app, resource, action } = options
  return `${app}:${resource ? `:${resource}` : ""}:${action}`
}

export type Permission = `${string}:${string}:${string}` | `${string}:${string}`
