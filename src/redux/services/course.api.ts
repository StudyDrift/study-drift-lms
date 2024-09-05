import { Course, CourseCreatePayload } from "@/models/course.model"
import { api } from "./api"

export const courseApi = api.injectEndpoints({
  endpoints: (build) => ({
    getMyCourses: build.query<Course[], void>({
      query: () => ({
        url: "courses",
        method: "GET",
      }),
      providesTags: ["Courses"],
    }),

    getCourseById: build.query<Course, string>({
      query: (id) => ({
        url: `courses/${id}`,
        method: "GET",
      }),
      providesTags: ["Course"],
    }),

    createCourse: build.mutation<Course, CourseCreatePayload>({
      query: (body) => ({
        url: "courses",
        method: "POST",
        body,
      }),
      invalidatesTags: ["Course", "Courses"],
    }),
  }),
})

export const {
  useCreateCourseMutation,
  useGetMyCoursesQuery,
  useGetCourseByIdQuery,
} = courseApi
