import {
  UpdateUserSettingsPayload,
  UserSettings,
} from "@/models/user-settings.model"
import { getCollection } from "./database.service"

export const updateUserSettings = async (
  userId: string,
  payload: UpdateUserSettingsPayload
) => {
  const collection = await getCollection<UserSettings>("userSettings")
  await collection.updateOne({ userId }, { $set: payload }, { upsert: true })
}

export const getUserSettings = async (userId: string) => {
  const collection = await getCollection<UserSettings>("userSettings")
  return await collection.findOne({ userId }, { projection: { _id: 0 } })
}
