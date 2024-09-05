import { CreateOutcomePayload, Outcome } from "@/models/outcome.model"
import { nanoid } from "@reduxjs/toolkit"
import { getCollection } from "./database.service"

const getOutcomeCollection = async () => {
  return await getCollection<Outcome>("outcomes")
}

export const createOutcomes = async (outcomes: CreateOutcomePayload[]) => {
  const collection = await getOutcomeCollection()
  const newOutcomes = outcomes.map((o) => ({ ...o, id: nanoid() }))
  await collection.insertMany(newOutcomes)

  return newOutcomes
}

export const createOutcome = async (outcome: CreateOutcomePayload) => {
  const collection = await getOutcomeCollection()
  const newOutcome = {
    ...outcome,
    id: nanoid(),
  }
  await collection.insertOne(newOutcome)

  return newOutcome
}

export const getById = async (id: string) => {
  const collection = await getOutcomeCollection()
  return await collection.findOne({ id }, { projection: { _id: 0 } })
}

export const getByIds = async (ids: string[]) => {
  const collection = await getOutcomeCollection()
  return await collection
    .find({ id: { $in: ids } }, { projection: { _id: 0 } })
    .toArray()
}

export const updateOutcome = async (id: string, payload: Partial<Outcome>) => {
  const collection = await getOutcomeCollection()
  await collection.updateOne({ id }, { $set: payload })
}
