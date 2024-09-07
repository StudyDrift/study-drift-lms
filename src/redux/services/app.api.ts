import { UserAppSettings } from "@/models/apps.model"
import { api } from "./api"

export const appApi = api.injectEndpoints({
  endpoints: (build) => ({
    getAppVersion: build.query<string, void>({
      query: () => ({
        url: "apps/version",
        method: "GET",
      }),
      transformResponse: (response: { version: string }) => response.version,
    }),
    getUserAppSettings: build.query<UserAppSettings, string>({
      query: (app) => ({
        url: `apps/${app}/settings/user`,
        method: "GET",
      }),
      providesTags: ["AppSettings"],
    }),
    updateUserAppSettings: build.mutation<UserAppSettings, UserAppSettings>({
      query: ({ settings, app }) => ({
        url: `apps/${app}/settings/user`,
        method: "PATCH",
        body: settings,
      }),
      invalidatesTags: ["AppSettings"],
    }),
  }),
})

export const {
  useGetAppVersionQuery,
  useGetUserAppSettingsQuery,
  useUpdateUserAppSettingsMutation,
} = appApi
