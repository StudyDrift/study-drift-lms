import { CreateOutcomePayload, Outcome } from "@/models/outcome.model"
import { api } from "./api"

export const outcomeApi = api.injectEndpoints({
  endpoints: (build) => ({
    createOutcomes: build.mutation<Outcome[], CreateOutcomePayload[]>({
      query: (body) => ({
        url: "outcomes",
        method: "POST",
        body,
      }),
      invalidatesTags: ["Outcomes"],
    }),
    getOutcomesByIds: build.query<Outcome[], string[]>({
      query: (outcomeIds) => ({
        url: "outcomes",
        method: "GET",
        params: {
          outcomeIds: outcomeIds.join(","),
        },
      }),
      providesTags: ["Outcomes"],
    }),
  }),
})

export const { useCreateOutcomesMutation, useGetOutcomesByIdsQuery } =
  outcomeApi
