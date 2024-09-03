import { User } from "@/models/user.model"
import { nanoid } from "@reduxjs/toolkit"
import { getCollection } from "./database.service"

const getUserCollection = async () => {
  return await getCollection<User>("users")
}

/**
 * Used during the SSO provisioning flow
 */
export const provisionUser = async (
  payload: Pick<User, "first" | "last" | "email">
) => {
  const user: User = {
    ...payload,
    id: nanoid(),
    meta: {},
  }

  const collection = await getUserCollection()
  collection.insertOne(user)

  return user
}

export const getUser = async (id: string) => {
  const collection = await getUserCollection()
  return await collection.findOne({ id })
}

export const getUserByEmail = async (email: string) => {
  const collection = await getUserCollection()
  return await collection.findOne({ email })
}

export const searchUsers = async (query: string) => {
  if (!query) {
    return []
  }

  query = query.trim().toLowerCase()

  const collection = await getUserCollection()

  return collection.find({ $text: { $search: query } }).toArray()
}

export const updateUser = async (id: string, payload: Partial<User>) => {
  const collection = await getUserCollection()

  await collection.updateOne({ id }, { $set: payload })
}
