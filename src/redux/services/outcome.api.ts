import { CreateOutcomePayload, Outcome } from "@/models/outcome.model"
import { api } from "./api"

export const outcomeApi = api.injectEndpoints({
  endpoints: (build) => ({
    createOutcomes: build.mutation<Outcome[], CreateOutcomePayload[]>({
      query: (body) => ({
        url: "outcome",
        method: "POST",
        body,
      }),
      invalidatesTags: ["Outcomes"],
    }),
  }),
})

export const { useCreateOutcomesMutation } = outcomeApi
