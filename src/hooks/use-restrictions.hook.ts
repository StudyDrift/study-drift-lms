import { Permission } from "@/models/permissions/permissions.model"
import { redirect } from "next/navigation"

export const useRestrictions = (permission?: Permission) => {
  if (!permission) return null

  if (false) {
    return redirect("/not-authorized")
  }

  return null
}

export const useCheckPermission = (permission?: Permission) => {
  if (!permission) return true
  return true
}

export const useCheckPermissions = (permissions: Permission[]) => {
  if (permissions.length === 0) return true
  return true
}
