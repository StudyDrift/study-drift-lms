import {
  UpdateUserSettingsPayload,
  UserSettings,
} from "@/models/user-settings.model"
import {
  getUserId,
  success,
  toJson,
  unauthorized,
} from "@/server/services/request.service"
import {
  getUserSettings,
  updateUserSettings,
} from "@/server/services/user-settings.service"
import { NextRequest } from "next/server"

export const GET = async (req: NextRequest) => {
  const userId = getUserId(req)
  if (!userId) return unauthorized()

  const settings = await getUserSettings(userId)
  return success(settings)
}

export const PATCH = async (req: NextRequest) => {
  const userId = getUserId(req)
  if (!userId) return unauthorized()
  const body = await toJson<UpdateUserSettingsPayload>(req)
  const settings = (await getUserSettings(userId)) as UserSettings
  const newSettings: UserSettings = {
    ...settings,
    ...body,
  }
  await updateUserSettings(userId, newSettings)

  return success(newSettings)
}
