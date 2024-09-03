import {
  ContentModule,
  CreateContentModulePayload,
} from "@/models/content.model"
import { api } from "./api"

export const contentApi = api.injectEndpoints({
  endpoints: (build) => ({
    getCourseContent: build.query<ContentModule[], string>({
      query: (courseId) => ({
        url: `content/${courseId}/module`,
        method: "GET",
      }),
      providesTags: ["Content"],
    }),
    createModule: build.mutation<ContentModule, CreateContentModulePayload>({
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
