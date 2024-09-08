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
        invalidatesTags: ["Announcements", "UnreadAnnouncementsCount"],
      }
    ),

    setViewAnnouncement: build.mutation<
      void,
      { announcementId: string; courseId: string }
    >({
      query: ({ announcementId, courseId }) => ({
        url:
          "courses/" +
          courseId +
          "/announcements/" +
          announcementId +
          "/viewed",
        method: "POST",
      }),
      invalidatesTags: ["Announcements", "UnreadAnnouncementsCount"],
    }),

    getUnreadAnnouncementCount: build.query<number, string>({
      query: (courseId) => ({
        url: "courses/" + courseId + "/announcements/unread",
        method: "GET",
        params: {
          onlyCount: "true",
        },
      }),
      providesTags: ["UnreadAnnouncementsCount"],
    }),

    deleteAnnouncement: build.mutation<void, { courseId: string; id: string }>({
      query: ({ courseId, id }) => ({
        url: "courses/" + courseId + "/announcements/" + id,
        method: "DELETE",
      }),
      invalidatesTags: ["Announcements", "UnreadAnnouncementsCount"],
    }),
  }),
})

export const {
  useGetCourseAnnouncementsQuery,
  useCreateAnnouncementMutation,
  useSetViewAnnouncementMutation,
  useGetUnreadAnnouncementCountQuery,
  useDeleteAnnouncementMutation,
} = announcementApi
