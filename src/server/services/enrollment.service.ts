import { Enrollment, EnrollmentCreatePayload } from "@/models/enrollment.model"
import { nanoid } from "@reduxjs/toolkit"
import { createAudit, getAuditDate } from "./audit.service"
import { getCollection } from "./database.service"

const getEnrollmentCollection = async () => {
  return await getCollection<Enrollment>("enrollments")
}

export const enrollUser = async (
  enrollment: EnrollmentCreatePayload,
  userId: string
) => {
  const newEnrollment: Enrollment = {
    ...enrollment,
    id: nanoid(),
  }

  const collection = await getEnrollmentCollection()
  await collection.insertOne(newEnrollment)

  await createAudit({
    userId,
    resourceType: "enrollment",
    resourceId: newEnrollment.id,
    action: "create",
    date: getAuditDate(),
    meta: newEnrollment,
  })

  return newEnrollment
}

export const getBySectionId = async (sectionId: string) => {
  const collection = await getEnrollmentCollection()
  return await collection
    .find({ sectionId }, { projection: { _id: 0 } })
    .toArray()
}

export const getEnrollmentsByCourseId = async (courseId: string) => {
  const collection = await getEnrollmentCollection()
  return await collection
    .find({ courseId }, { projection: { _id: 0 } })
    .toArray()
}

export const getByUserId = async (userId: string) => {
  const collection = await getEnrollmentCollection()
  return await collection.find({ userId }, { projection: { _id: 0 } }).toArray()
}

export const getById = async (id: string) => {
  const collection = await getEnrollmentCollection()
  return await collection.findOne({ id }, { projection: { _id: 0 } })
}

export const updateEnrollment = async (
  id: string,
  payload: Partial<Enrollment>,
  userId: string
) => {
  const collection = await getEnrollmentCollection()
  await collection.updateOne({ id }, { $set: payload })

  await createAudit({
    userId,
    resourceType: "enrollment",
    resourceId: id,
    action: "update",
    date: getAuditDate(),
    meta: payload,
  })
}

export const getEnrollmentByUserAndCourse = async (
  userId: string,
  courseId: string
) => {
  const collection = await getEnrollmentCollection()
  return await collection.findOne(
    { userId, courseId },
    { projection: { _id: 0 } }
  )
}

export const deleteEnrollment = async (id: string, userId: string) => {
  const collection = await getEnrollmentCollection()
  await collection.deleteOne({ id })

  await createAudit({
    userId,
    resourceType: "enrollment",
    resourceId: id,
    action: "delete",
    date: getAuditDate(),
    meta: {},
  })
}
