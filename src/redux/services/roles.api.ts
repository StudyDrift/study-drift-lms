import { Role } from "@/models/permissions/permissions.model"
import { api } from "./api"

export const rolesApi = api.injectEndpoints({
  endpoints: (build) => ({
    getAllRoles: build.query<Role[], void>({
      query: () => "roles",
      providesTags: ["Roles"],
    }),
    getCourseRoles: build.query<Role[], string>({
      query: (courseId) => ({
        url: `courses/${courseId}/roles`,
        method: "GET",
      }),
      providesTags: ["Roles"],
    }),
  }),
})

export const { useGetAllRolesQuery, useGetCourseRolesQuery } = rolesApi
