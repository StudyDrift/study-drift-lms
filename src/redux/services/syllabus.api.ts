import { Syllabus, UpdateSyllabusPayload } from "@/models/syllabus.model"
import { api } from "./api"

export const syllabusApi = api.injectEndpoints({
  endpoints: (build) => ({
    getSyllabusByCourseId: build.query<Syllabus, string>({
      query: (courseId) => ({
        url: `/courses/${courseId}/syllabus`,
        method: "GET",
      }),
      providesTags: ["Syllabus"],
    }),

    updateSyllabus: build.mutation<Syllabus, UpdateSyllabusPayload>({
      query: ({ courseId, body }) => ({
        url: `/courses/${courseId}/syllabus`,
        method: "PATCH",
        body: {
          body,
          courseId,
        },
      }),
      invalidatesTags: ["Syllabus"],
    }),
  }),
})

export const { useGetSyllabusByCourseIdQuery, useUpdateSyllabusMutation } =
  syllabusApi
