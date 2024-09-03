import { ContentModule } from "@/models/content.model"
import { api } from "./api"

export const contentApi = api.injectEndpoints({
  endpoints: (build) => ({
    getCourseContent: build.query<ContentModule[], string>({
      query: (courseId) => ({
        url: `content/${courseId}`,
        method: "GET",
      }),
      providesTags: ["Content"],
    }),
    createModule: build.mutation<ContentModule, ContentModule>({
      query: (body) => ({
        url: `content/${body.courseId}/module`,
        method: "POST",
        body,
      }),
      invalidatesTags: ["Content"],
    }),
  }),
})

export const { useGetCourseContentQuery, useCreateModuleMutation } = contentApi
