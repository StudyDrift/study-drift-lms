import {
  ContentItem,
  ContentModule,
  CreateContentItemPayload,
  CreateContentModulePayload,
  UpdateContentItemPayload,
} from "@/models/content.model"
import { api } from "./api"

export const contentApi = api.injectEndpoints({
  endpoints: (build) => ({
    getCourseContent: build.query<ContentModule[], string>({
      query: (courseId) => ({
        url: `courses/${courseId}/modules`,
        method: "GET",
      }),
      providesTags: ["Content"],
    }),
    createModule: build.mutation<ContentModule, CreateContentModulePayload>({
      query: (body) => ({
        url: `courses/${body.courseId}/modules`,
        method: "POST",
        body,
      }),
      invalidatesTags: ["Content"],
    }),
    setModuleOrder: build.mutation<void, { courseId: string; order: string[] }>(
      {
        query: ({ courseId, order }) => ({
          url: `courses/${courseId}/modules/order`,
          method: "PATCH",
          body: order,
        }),
        invalidatesTags: ["Content"],
      }
    ),
    createContentItem: build.mutation<ContentItem, CreateContentItemPayload>({
      query: (body) => ({
        url: `courses/${body.courseId}/content-items`,
        method: "POST",
        body,
      }),
      invalidatesTags: ["Content"],
    }),
    publishContentItem: build.mutation<
      void,
      { contentItemId: string; courseId: string; isPublished: boolean }
    >({
      query: ({ contentItemId, courseId, isPublished }) => ({
        url: `courses/${courseId}/content-items/${contentItemId}/publish`,
        method: "PATCH",
        body: {
          isPublished,
        },
      }),
      invalidatesTags: ["Content"],
    }),
    setContentItemsOrder: build.mutation<
      void,
      { courseId: string; contentItemIds: string[] }
    >({
      query: ({ courseId, contentItemIds }) => ({
        url: `courses/${courseId}/content-items/order`,
        method: "PATCH",
        body: contentItemIds,
      }),
      invalidatesTags: ["Content"],
    }),
    deleteContentItem: build.mutation<
      void,
      { contentItemId: string; courseId: string }
    >({
      query: ({ contentItemId, courseId }) => ({
        url: `courses/${courseId}/content-items/${contentItemId}`,
        method: "DELETE",
      }),
      invalidatesTags: ["Content"],
    }),
    deleteContentModule: build.mutation<
      void,
      { moduleId: string; courseId: string }
    >({
      query: ({ moduleId, courseId }) => ({
        url: `courses/${courseId}/modules/${moduleId}`,
        method: "DELETE",
      }),
      invalidatesTags: ["Content"],
    }),
    updateModule: build.mutation<
      ContentModule,
      {
        id: string
        module: CreateContentModulePayload
        courseId: string
      }
    >({
      query: (body) => ({
        url: `courses/${body.courseId}/modules/${body.id}`,
        method: "PATCH",
        body: body.module,
      }),
      invalidatesTags: ["Content"],
    }),
    getContentItemById: build.query<
      ContentItem,
      { contentItemId: string; courseId: string }
    >({
      query: (body) => ({
        url: `courses/${body.courseId}/content-items/${body.contentItemId}`,
        method: "GET",
      }),
      providesTags: ["ContentItem"],
    }),
    updateContentItem: build.mutation<
      ContentItem,
      {
        id: string
        contentItem: UpdateContentItemPayload
        courseId: string
      }
    >({
      query: (body) => ({
        url: `courses/${body.courseId}/content-items/${body.id}`,
        method: "PATCH",
        body: body.contentItem,
      }),
      invalidatesTags: ["ContentItem"],
    }),
  }),
})

export const {
  useGetCourseContentQuery,
  useCreateModuleMutation,
  useSetModuleOrderMutation,
  useCreateContentItemMutation,
  usePublishContentItemMutation,
  useSetContentItemsOrderMutation,
  useDeleteContentItemMutation,
  useDeleteContentModuleMutation,
  useUpdateModuleMutation,
  useGetContentItemByIdQuery,
  useUpdateContentItemMutation,
} = contentApi
