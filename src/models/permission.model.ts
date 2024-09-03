// orgId:domain:resource:action
type PermissionFormat = `${string}:${string}:${string}:${string}`

export interface Permission {
  value: PermissionFormat
  description: string
}
