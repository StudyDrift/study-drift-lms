import { Permission } from "@/models/permissions/permissions.model"
import { PropsWithChildren } from "react"

interface Props extends PropsWithChildren {
  permission: Permission
}

export const Restrict = ({ children, permission }: Props) => {
  if (!permission) return null
  return <>{children}</>
}

export const RestrictElse = ({ children, permission }: Props) => {
  if (!permission) return <>{children}</>
  return null
}
