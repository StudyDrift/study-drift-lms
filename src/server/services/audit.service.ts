import { Audit } from "@/models/audit.model"
import { nanoid } from "@reduxjs/toolkit"
import { getCollection } from "./database.service"

export const getAuditCollection = async () => {
  return await getCollection<Audit>("audits")
}

export const createAudit = async (audit: Omit<Audit, "id">) => {
  const collection = await getAuditCollection()
  await collection.insertOne({
    ...audit,
    id: nanoid(),
  })
}

export const getAuditDate = () => new Date().toISOString()
