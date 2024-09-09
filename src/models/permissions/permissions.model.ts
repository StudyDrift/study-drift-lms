export type Permission = `${string}:${string}:${string}` | `${string}:${string}`

export enum PermissionAction {
  Create = "Create",
  Read = "Read",
  Update = "Update",
  Delete = "Delete",
  View = "View",
}

export interface PermissionOptions {
  service: string
  resource?: string
  action: PermissionAction
}

export interface Role {
  name: string
  description: string
  scope?: string
  permissions: Permission[]
}

export const generatePermission = (options: PermissionOptions): Permission => {
  const { service, resource, action } = options
  return `${service || ""}:${resource || ""}:${action || ""}`
}

export const getRoleParts = (permission: Permission) => {
  const [service, resource, action] = permission.split(":")
  return { service, resource, action }
}
