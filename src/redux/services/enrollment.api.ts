import { Enrollment } from "@/models/enrollment.model"
import { api } from "./api"

export const enrollmentApi = api.injectEndpoints({
  endpoints: (build) => ({
    getEnrollmentsByCourseId: build.query<Enrollment[], string>({
      query: (courseId) => ({
        url: `courses/${courseId}/enrollments`,
        method: "GET",
      }),
      providesTags: ["Enrollments"],
    }),
  }),
})

export const { useGetEnrollmentsByCourseIdQuery } = enrollmentApi
