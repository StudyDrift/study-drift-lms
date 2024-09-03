export interface User {
  id: string
  first: string
  last: string
  email: string
  imgUrl?: string
  meta: Record<string, any>
}
