export interface Audit {
  id: string
  action: string
  userId: string
  resourceType: string
  resourceId: string
  meta: Record<string, any>
  date: string
}
