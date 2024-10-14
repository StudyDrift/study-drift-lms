import { Version } from "@/models/version.model"
import { api } from "./api"

export const versionsApi = api.injectEndpoints({
  endpoints: (build) => ({
    getGlobalAppVersion: build.query<Version, void>({
      query: () => ({
        url: `versions?scope=app`,
        method: "GET",
      }),
      providesTags: ["Version"],
    }),
  }),
})

export const { useGetGlobalAppVersionQuery } = versionsApi
