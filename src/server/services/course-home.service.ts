import { CourseHome, UpdateCourseHomePayload } from "@/models/course-home.model"
import { createAudit, getAuditDate } from "./audit.service"
import { getCollection } from "./database.service"

export const updateCourseHome = async (
  courseId: string,
  payload: UpdateCourseHomePayload,
  userId: string
) => {
  const collection = await getCollection<CourseHome>("courseHome")

  await collection.updateOne(
    { courseId },
    {
      $set: payload,
    },
    { upsert: true }
  )

  await createAudit({
    userId,
    resourceType: "courseHome",
    resourceId: courseId,
    action: "update",
    date: getAuditDate(),
    meta: payload,
  })
}

export const getCourseHome = async (courseId: string) => {
  const collection = await getCollection<CourseHome>("courseHome")
  return await collection.findOne({ courseId })
}
