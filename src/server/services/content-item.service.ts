import {
  ContentItem,
  CreateContentItemPayload,
  UpdateContentItemPayload,
} from "@/models/content.model"
import { nanoid } from "nanoid"
import { createAudit, getAuditDate } from "./audit.service"
import { getCollection } from "./database.service"

export const createContentItem = async (
  item: CreateContentItemPayload,
  userId: string
) => {
  const collection = await getCollection<ContentItem>("contentItems")
  const newItem: ContentItem = {
    ...item,
    id: nanoid(),
  }

  await collection.insertOne(newItem)

  await createAudit({
    userId,
    action: "create",
    meta: newItem,
    resourceId: newItem.id,
    resourceType: "contentItem",
    date: getAuditDate(),
  })

  return newItem
}

export const getContentItemsByModuleIds = async (
  moduleIds: string[],
  full = false
) => {
  const collection = await getCollection<ContentItem>("contentItems")

  let options = {}
  if (!full) {
    options = {
      body: 0,
      meta: 0,
      description: 0,
    }
  }

  return collection
    .find(
      {
        contentModuleId: {
          $in: moduleIds,
        },
      },
      { projection: { _id: 0, ...options } }
    )
    .sort({ order: 1 })
    .toArray()
}

export const publishContentItem = async (
  id: string,
  isPublished: boolean,
  userId: string
) => {
  const collection = await getCollection<ContentItem>("contentItems")
  await collection.updateOne(
    { id },
    { $set: { "settings.isPublished": isPublished } }
  )

  await createAudit({
    userId,
    resourceType: "contentItem",
    resourceId: id,
    action: "publish",
    date: getAuditDate(),
    meta: { isPublished },
  })
}

export const updateContentItemOrder = async (
  courseId: string,
  ids: string[]
) => {
  const collection = await getCollection<ContentItem>("contentItems")

  await collection.bulkWrite(
    ids.map((id, index) => ({
      updateOne: {
        filter: { id, courseId },
        update: { $set: { order: index } },
      },
    }))
  )
}

export const deleteContentItem = async (id: string, userId: string) => {
  const collection = await getCollection<ContentItem>("contentItems")
  await collection.deleteOne({ id })

  const item = await collection.findOne({ id })

  await createAudit({
    userId,
    resourceType: "contentItem",
    resourceId: id,
    action: "delete",
    date: getAuditDate(),
    meta: item || {},
  })
}

export const getContentItemById = async (id: string) => {
  const collection = await getCollection<ContentItem>("contentItems")
  return collection.findOne({ id }, { projection: { _id: 0 } })
}

export const updateContentItem = async (
  itemId: string,
  item: UpdateContentItemPayload,
  userId: string
) => {
  const collection = await getCollection<ContentItem>("contentItems")

  await collection.updateOne({ id: itemId }, { $set: item })

  await createAudit({
    userId,
    resourceType: "contentItem",
    resourceId: itemId,
    action: "update",
    date: getAuditDate(),
    meta: item,
  })
}

export const getContentItemsByCourseId = async (courseId: string) => {
  const collection = await getCollection<ContentItem>("contentItems")
  return collection.find({ courseId }).sort({ order: 1 }).toArray()
}

export const getContentItemWithDueDate = async (courseId: string) => {
  const collection = await getCollection<ContentItem>("contentItems")
  return collection
    .find({ courseId, "settings.dueDate": { $exists: true } })
    .sort({ order: 1 })
    .toArray()
}
