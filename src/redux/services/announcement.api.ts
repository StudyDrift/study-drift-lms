import {
  Announcement,
  CreateAnnouncementPayload,
} from "@/models/announcement.model"
import { api } from "./api"

export const announcementApi = api.injectEndpoints({
  endpoints: (build) => ({
    getCourseAnnouncements: build.query<Announcement[], string>({
      query: (courseId) => ({
        url: "courses/" + courseId + "/announcements",
        method: "GET",
      }),
      providesTags: ["Announcements"],
    }),

    createAnnouncement: build.mutation<Announcement, CreateAnnouncementPayload>(
      {
        query: (body) => ({
          url: "courses/" + body.courseId + "/announcements",
          method: "POST",
          body,
        }),
        invalidatesTags: ["Announcements"],
      }
    ),
  }),
})

export const { useGetCourseAnnouncementsQuery, useCreateAnnouncementMutation } =
  announcementApi
