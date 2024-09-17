import { CourseHome, UpdateCourseHomePayload } from "@/models/course-home.model"
import { api } from "./api"

export const courseHomeApi = api.injectEndpoints({
  endpoints: (build) => ({
    getCourseHome: build.query<CourseHome, string>({
      query: (courseId) => ({
        url: `courses/${courseId}/home`,
        method: "GET",
      }),
      providesTags: ["CourseHome"],
    }),

    updateCourseHome: build.mutation<
      CourseHome,
      { courseId: string; payload: UpdateCourseHomePayload }
    >({
      query: ({ courseId, payload }) => ({
        url: `courses/${courseId}/home`,
        method: "POST",
        body: payload,
      }),
      invalidatesTags: ["CourseHome"],
    }),
  }),
})

export const { useGetCourseHomeQuery, useUpdateCourseHomeMutation } =
  courseHomeApi
