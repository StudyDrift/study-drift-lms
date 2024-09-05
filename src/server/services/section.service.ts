import { Section } from "@/models/section.model"
import { nanoid } from "@reduxjs/toolkit"
import { createAudit, getAuditDate } from "./audit.service"
import { getCollection } from "./database.service"

const getSectionCollection = async () => {
  return await getCollection<Section>("sections")
}

export const createSection = async (
  section: Omit<Section, "id">,
  userId: string
) => {
  const newSection: Section = {
    ...section,
    id: nanoid(),
  }

  const collection = await getSectionCollection()
  await collection.insertOne(newSection)

  await createAudit({
    userId,
    resourceType: "section",
    resourceId: newSection.id,
    action: "create",
    date: getAuditDate(),
    meta: newSection,
  })

  return newSection
}

export const getSectionById = async (id: string) => {
  const collection = await getSectionCollection()
  return await collection.findOne({ id }, { projection: { _id: 0 } })
}

export const getSectionByIds = async (ids: string[]) => {
  const collection = await getSectionCollection()
  return await collection
    .find({ id: { $in: ids } }, { projection: { _id: 0 } })
    .toArray()
}

export const getSectionsByCourseId = async (courseId: string) => {
  const collection = await getSectionCollection()
  return await collection
    .find({ courseId }, { projection: { _id: 0 } })
    .toArray()
}

export const updateSection = async (
  id: string,
  payload: Partial<Section>,
  userId: string
) => {
  const collection = await getSectionCollection()
  await collection.updateOne({ id }, { $set: payload })

  await createAudit({
    userId,
    resourceType: "section",
    resourceId: id,
    action: "update",
    date: getAuditDate(),
    meta: payload,
  })
}
