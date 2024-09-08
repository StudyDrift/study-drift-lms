import {
  Announcement,
  CreateAnnouncementPayload,
} from "@/models/announcement.model"
import { nanoid } from "nanoid"
import { getCollection } from "./database.service"

export const getCourseAnnouncements = async (courseId: string) => {
  const collection = await getCollection<Announcement>("announcements")

  return collection
    .find({ courseId }, { projection: { _id: 0 } })
    .sort({ createdAt: -1 })
    .toArray()
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
  }
  const collection = await getCollection<Announcement>("announcements")
  await collection.insertOne(newAnnouncement)

  return newAnnouncement
}
