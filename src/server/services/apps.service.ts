import { UserAppSettings } from "@/models/apps.model"
import { getCollection } from "./database.service"

export const getAppsUserSettings = async (userId: string, app: string) => {
  const collection = await getCollection<UserAppSettings>("appsUserSettings")
  return await collection.findOne(
    {
      userId,
      app,
    },
    { projection: { _id: 0 } }
  )
}

export const updateAppsUserSettings = async (
  userId: string,
  app: string,
  settings: UserAppSettings
) => {
  const collection = await getCollection<UserAppSettings>("appsUserSettings")
  await collection.updateOne(
    {
      userId,
      app,
    },
    { $set: settings },
    { upsert: true }
  )
}
