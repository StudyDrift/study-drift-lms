import { ChatSession } from "@/models/ai.model"
import { api } from "./api"

export const aiApi = api.injectEndpoints({
  endpoints: (build) => ({
    getCompletion: build.mutation<ChatSession, ChatSession>({
      query: (session) => ({
        method: "POST",
        url: "ai/completion",
        body: session,
      }),
      invalidatesTags: ["ChatSession"],
    }),
  }),
})

export const { useGetCompletionMutation } = aiApi
