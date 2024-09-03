import {
  ContentModule,
  CreateContentModulePayload,
} from "@/models/content.model"
import { nanoid } from "nanoid"
import { createAudit, getAuditDate } from "./audit.service"
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

export const getContentModulesByCourseId = async (courseId: string) => {
  const collection = await getCollection<ContentModule>(COLLECTION)
  return await collection.find({ courseId }).toArray()
}
