import { Command, CommandContextOption } from "@/models/command.model"
import { api } from "./api"

export const commandApi = api.injectEndpoints({
  endpoints: (build) => ({
    getCommands: build.query<Command[], CommandContextOption>({
      query: ({ courseId }) => ({
        url: "commands",
        method: "GET",
        params: {
          courseId,
        },
      }),
      providesTags: ["Commands"],
      extraOptions: {
        maxRetries: 1,
      },
    }),
  }),
})

export const { useGetCommandsQuery } = commandApi
