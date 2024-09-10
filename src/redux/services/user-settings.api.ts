import {
  UpdateUserSettingsPayload,
  UserSettings,
} from "@/models/user-settings.model"
import { api } from "./api"

export const userSettingsApi = api.injectEndpoints({
  endpoints: (build) => ({
    getUserSettings: build.query<UserSettings, void>({
      query: () => ({
        url: `users/settings`,
        method: "GET",
      }),
      providesTags: ["UserSettings"],
    }),

    updateUserSettings: build.mutation<UserSettings, UpdateUserSettingsPayload>(
      {
        query: (body) => ({
          url: `users/settings`,
          method: "PATCH",
          body,
        }),
        invalidatesTags: ["UserSettings"],
      }
    ),
  }),
})

export const { useGetUserSettingsQuery, useUpdateUserSettingsMutation } =
  userSettingsApi
