import { Term } from "@/models/term.model"
import { nanoid } from "nanoid"
import { getCollection } from "./database.service"

const getTermCollection = async () => {
  return await getCollection<Term>("terms")
}

export const createTerm = async (payload: Omit<Term, "id">) => {
  const term = {
    ...payload,
    id: nanoid(),
  }
  const collection = await getTermCollection()
  await collection.insertOne(term)

  return term
}

export const getByIds = async (ids: string[]) => {
  const collection = await getTermCollection()
  return await collection
    .find({ id: { $in: ids } }, { projection: { _id: 0 } })
    .toArray()
}

export const getById = async (id: string) => {
  const collection = await getTermCollection()
  return await collection.findOne({ id }, { projection: { _id: 0 } })
}

export const getByDateRange = async (start: string, end: string) => {
  const collection = await getTermCollection()
  return await collection
    .find(
      {
        dates: {
          $and: [{ start: { $lte: start } }, { end: { $gte: end } }],
        },
      },
      { projection: { _id: 0 } }
    )
    .toArray()
}
