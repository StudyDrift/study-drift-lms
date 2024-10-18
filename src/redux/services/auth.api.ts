import { api } from "./api"

export const authApi = api.injectEndpoints({
  endpoints: (build) => ({
    login: build.mutation<any, any>({
      query: (body) => ({
        url: "auth/login",
        method: "POST",
        body,
      }),
      extraOptions: {
        maxRetries: 1,
      },
    }),
    signup: build.mutation<any, any>({
      query: (body) => ({
        url: "auth/register",
        method: "POST",
        body,
      }),
    }),
    getTokenAndClaims: build.query<
      { token: string; claims: Record<string, any> },
      void
    >({
      query: () => ({
        url: "auth/token",
        method: "GET",
      }),
    }),
    logout: build.mutation<void, void>({
      query: () => ({
        url: "auth/logout",
        method: "GET",
      }),
    }),
  }),
})

export const {
  useLoginMutation,
  useSignupMutation,
  useLogoutMutation,
  useGetTokenAndClaimsQuery,
} = authApi
