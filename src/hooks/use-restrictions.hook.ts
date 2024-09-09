import { Permission } from "@/models/permissions/permissions.model"
import { useGetAllPermissionsQuery } from "@/redux/services/permission.api"
import { redirect, useParams } from "next/navigation"

export const useRestrictions = (permission?: Permission) => {
  if (!permission) return null

  if (false) {
    return redirect("/not-authorized")
  }

  return null
}

export const useCheckPermission = (permission?: Permission) => {
  const { courseId } = useParams<{ courseId?: string }>()
  const { data: permissions, isLoading } = useGetAllPermissionsQuery({
    courseId,
  })

  const permissionGranted = permissions?.some((p) => p === permission)

  return permissionGranted && !isLoading
}

export const useCheckPermissions = (permissions: Permission[]) => {
  const { courseId } = useParams<{ courseId?: string }>()
  const { data: userPermissions, isLoading } = useGetAllPermissionsQuery({
    courseId,
  })

  return (
    permissions.every((p) => userPermissions?.some((p2) => p === p2)) &&
    !isLoading
  )
}
