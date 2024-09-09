import { Syllabus, UpdateSyllabusPayload } from "@/models/syllabus.model"
import { nanoid } from "nanoid"
import { createAudit, getAuditDate } from "./audit.service"
import { getCollection } from "./database.service"

export const updateSyllabus = async (
  payload: UpdateSyllabusPayload,
  userId: string
) => {
  const collection = await getCollection<Syllabus>("syllabus")

  let syllabus = (await collection.findOne(
    { courseId: payload.courseId },
    { projection: { _id: 0 } }
  )) as Syllabus

  if (!syllabus) {
    syllabus = {
      ...payload,
      createdAt: new Date(),
      updatedAt: new Date(),
      id: nanoid(),
      body: payload.body,
      courseId: payload.courseId,
    }
    await collection.insertOne(syllabus)
  } else {
    await collection.updateOne(
      { courseId: payload.courseId },
      {
        $set: {
          ...payload,
          updatedAt: new Date(),
          body: payload.body,
        },
      }
    )

    syllabus = {
      ...syllabus,
      ...payload,
      updatedAt: new Date(),
      body: payload.body,
    }
  }

  await createAudit({
    userId,
    resourceType: "syllabus",
    resourceId: payload.courseId,
    action: "update",
    date: getAuditDate(),
    meta: syllabus,
  })

  return syllabus
}

export const getSyllabusByCourseId = async (courseId: string) => {
  const collection = await getCollection<Syllabus>("syllabus")
  return await collection.findOne({ courseId }, { projection: { _id: 0 } })
}
