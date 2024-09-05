import { ContentType } from "@/models/content.model"
import { api } from "./api"

export const contentTypeApi = api.injectEndpoints({
  endpoints: (build) => ({
    getAllContentTypes: build.query<ContentType[], string>({
      query: (courseId) => "/courses/" + courseId + "/content-types",
      providesTags: ["ContentTypes"],
    }),
  }),
})

export const { useGetAllContentTypesQuery } = contentTypeApi
