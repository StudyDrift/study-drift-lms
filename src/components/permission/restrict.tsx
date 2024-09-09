import { Permission } from "@/models/permissions/permissions.model"
import { useGetAllPermissionsQuery } from "@/redux/services/permission.api"
import { useParams } from "next/navigation"
import { PropsWithChildren } from "react"

interface Props extends PropsWithChildren {
  permission: Permission
}

export const Restrict = ({ children, permission }: Props) => {
  const { courseId } = useParams<{ courseId?: string }>()
  const { data: permissions, isLoading } = useGetAllPermissionsQuery({
    courseId,
  })

  const permissionGranted = permissions?.some((p) => p === permission)

  if (!permissionGranted || isLoading) return null
  return <>{children}</>
}

export const RestrictElse = ({ children, permission }: Props) => {
  const { courseId } = useParams<{ courseId?: string }>()
  const { data: permissions, isLoading } = useGetAllPermissionsQuery({
    courseId,
  })

  const permissionGranted = permissions?.some((p) => p === permission)

  if (!permissionGranted || isLoading) return <>{children}</>
  return null
}
