import { Term } from "@/models/term.model"
import { nanoid } from "@reduxjs/toolkit"
import { getCollection } from "./database.service"

const getTermCollection = async () => {
  return await getCollection<Term>("terms")
}

export const createTerm = async (term: Omit<Term, "id">) => {
  const collection = await getTermCollection()
  return await collection.insertOne({ ...term, id: nanoid() })
}

export const getByIds = async (ids: string[]) => {
  const collection = await getTermCollection()
  return await collection.find({ id: { $in: ids } }).toArray()
}

export const getById = async (id: string) => {
  const collection = await getTermCollection()
  return await collection.findOne({ id })
}

export const getByDateRange = async (start: string, end: string) => {
  const collection = await getTermCollection()
  return await collection
    .find({
      dates: {
        $and: [{ start: { $lte: start } }, { end: { $gte: end } }],
      },
    })
    .toArray()
}
