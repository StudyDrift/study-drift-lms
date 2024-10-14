import {
  Announcement,
  CreateAnnouncementPayload,
} from "@/models/announcement.model"
import { nanoid } from "nanoid"
import { getCollection } from "./database.service"

export const getCourseAnnouncements = async (
  courseId: string,
  userId: string
) => {
  const collection = await getCollection<Announcement>("announcements")

  // If userId is in viewedByIds, set a new property called isViewed to true
  const announcements = await collection
    .find({ courseId })
    .project({ _id: 0 })
    .toArray()

  return announcements.map((announcement) => {
    return {
      ...announcement,
      isViewed: announcement.viewedByIds.includes(userId),
      viewedByIds: undefined,
    }
  })
}

export const createAnnouncement = async (
  announcement: CreateAnnouncementPayload,
  userId: string,
  courseId: string
) => {
  const newAnnouncement: Announcement = {
    ...announcement,
    id: nanoid(),
    postedById: userId,
    courseId,
    viewedByIds: [],
    dates: {},
    isViewed: false,
    meta: {},
  }
  const collection = await getCollection<Announcement>("announcements")
  await collection.insertOne(newAnnouncement)

  return newAnnouncement
}

export const setViewAnnouncement = async (
  announcementId: string,
  userId: string
) => {
  const collection = await getCollection<Announcement>("announcements")
  await collection.updateOne(
    { id: announcementId },
    { $addToSet: { viewedByIds: userId } }
  )
}

export const getUnreadAnnouncements = async (
  courseId: string,
  userId: string,
  onlyCount = false
) => {
  const collection = await getCollection<Announcement>("announcements")

  if (onlyCount) {
    return await collection.countDocuments({
      courseId,
      viewedByIds: { $ne: userId },
    })
  }

  return await collection
    .find({
      courseId,
      viewedByIds: { $ne: userId },
    })
    .project({ _id: 0 })
    .toArray()
}

export const deleteAnnouncement = async (courseId: string, id: string) => {
  const collection = await getCollection<Announcement>("announcements")
  await collection.deleteOne({ id, courseId })
}
