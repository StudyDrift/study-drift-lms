import {
  ContentModule,
  CreateContentModulePayload,
  UpdateContentModulePayload,
} from "@/models/content.model"
import { nanoid } from "nanoid"
import { createAudit, getAuditDate } from "./audit.service"
import { deleteContentItem } from "./content-item.service"
import { getCollection } from "./database.service"

const COLLECTION = "modules"

export const createContentModule = async (
  payload: CreateContentModulePayload,
  userId: string
) => {
  const contentModule = {
    ...payload,
    id: nanoid(),
  }

  const collection = await getCollection<ContentModule>(COLLECTION)

  await createAudit({
    userId,
    resourceType: "contentModule",
    resourceId: contentModule.id,
    action: "create",
    date: getAuditDate(),
    meta: contentModule,
  })

  return await collection.insertOne(contentModule)
}

export const updateModuleOrder = async (
  courseId: string,
  moduleIds: string[]
) => {
  const collection = await getCollection<ContentModule>(COLLECTION)

  for (let i = 0; i < moduleIds.length; i++) {
    await collection.updateOne(
      { id: moduleIds[i], courseId },
      { $set: { order: i } }
    )
  }
}

export const getContentModulesByCourseId = async (courseId: string) => {
  const collection = await getCollection<ContentModule>(COLLECTION)
  return await collection
    .find({ courseId }, { projection: { _id: 0 } })
    .sort({ order: 1 })
    .toArray()
}

export const deleteModule = async (id: string, userId: string) => {
  const collection = await getCollection<ContentModule>(COLLECTION)
  await collection.deleteOne({ id })
  const contentModule = await collection.findOne({ id })
  const itemIds = contentModule?.children?.map((i) => i.id) || []

  for (const itemId of itemIds) {
    await deleteContentItem(itemId, userId)
  }

  await createAudit({
    userId,
    resourceType: "contentModule",
    resourceId: id,
    action: "delete",
    date: getAuditDate(),
    meta: contentModule || {},
  })
}

export const updateModule = async (
  itemId: string,
  item: UpdateContentModulePayload,
  userId: string
) => {
  const collection = await getCollection<ContentModule>(COLLECTION)

  await collection.updateOne({ id: itemId }, { $set: item })

  await createAudit({
    userId,
    resourceType: "contentModule",
    resourceId: itemId,
    action: "update",
    date: getAuditDate(),
    meta: item,
  })
}

export const getModuleById = async (id: string) => {
  const collection = await getCollection<ContentModule>(COLLECTION)
  return await collection.findOne({ id }, { projection: { _id: 0 } })
}
