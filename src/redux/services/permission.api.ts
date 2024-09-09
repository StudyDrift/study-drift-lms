import { Permission } from "@/models/permissions/permissions.model"
import { api } from "./api"

export const permissionApi = api.injectEndpoints({
  endpoints: (build) => ({
    getAllPermissions: build.query<Permission[], { courseId?: string }>({
      query: ({ courseId }) => ({
        url: "auth/permissions",
        method: "GET",
        params: {
          courseId,
        },
      }),
      providesTags: ["Permissions"],
    }),
  }),
})

export const { useGetAllPermissionsQuery } = permissionApi
