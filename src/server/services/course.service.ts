import { Course, CourseCreatePayload } from "@/models/course.model"
import { EnrollmentRole } from "@/models/enrollment.model"
import { nanoid } from "@reduxjs/toolkit"
import { createAudit, getAuditDate } from "./audit.service"
import { getCollection } from "./database.service"
import { enrollUserByUserId } from "./enrollment.service"

const getCourseCollection = async () => {
  return await getCollection<Course>("courses")
}

export const createCourse = async (
  course: CourseCreatePayload,
  userId: string
) => {
  const newCourse: Course = {
    ...course,
    id: nanoid(),
  }

  const collection = await getCourseCollection()
  await collection.insertOne(newCourse)

  await createAudit({
    userId,
    resourceType: "course",
    resourceId: newCourse.id,
    action: "create",
    date: getAuditDate(),
    meta: newCourse,
  })

  await enrollUserByUserId(
    {
      userId,
      courseId: newCourse.id,
      role: EnrollmentRole.owner,
      meta: {},
      dates: {
        start: new Date().toISOString(),
      },
    },
    userId
  )

  return newCourse
}

export const getCourseById = async (id: string) => {
  const collection = await getCourseCollection()
  return await collection.findOne({ id }, { projection: { _id: 0 } })
}

export const getCourseByIds = async (ids: string[]) => {
  const collection = await getCourseCollection()
  return await collection
    .find({ id: { $in: ids } }, { projection: { _id: 0 } })
    .toArray()
}

export const getCourseByCode = async (code: string) => {
  const collection = await getCourseCollection()
  return await collection.findOne({ code }, { projection: { _id: 0 } })
}

export const updateCourse = async (
  id: string,
  payload: Partial<Course>,
  userId: string
) => {
  const collection = await getCourseCollection()
  await collection.updateOne({ id }, { $set: payload })

  await createAudit({
    userId,
    resourceType: "course",
    resourceId: id,
    action: "update",
    date: getAuditDate(),
    meta: payload,
  })

  return
}
