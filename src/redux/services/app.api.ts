import { api } from "./api"

export const appApi = api.injectEndpoints({
  endpoints: (build) => ({
    getAppVersion: build.query<string, void>({
      query: () => ({
        url: "app/version",
        method: "GET",
      }),
      transformResponse: (response: { version: string }) => response.version,
    }),
  }),
})

export const { useGetAppVersionQuery } = appApi
