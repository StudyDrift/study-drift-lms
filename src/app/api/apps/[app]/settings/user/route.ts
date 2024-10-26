import { UserAppSettings } from "@/models/apps.model"
import { RequestParams } from "@/models/request.model"
import {
  getAppsUserSettings,
  updateAppsUserSettings,
} from "@/server/services/apps.service"
import {
  getUserId,
  success,
  unauthorized,
} from "@/server/services/request.service"
import { NextRequest } from "next/server"

export const GET = async (
  req: NextRequest,
  { params }: RequestParams<{ app: string }>
) => {
  const { app } = await params
  const userId = getUserId(req)
  if (!userId) return unauthorized()
  const settings = await getAppsUserSettings(userId, app)
  return success(settings)
}

export const PATCH = async (
  req: NextRequest,
  { params }: RequestParams<{ app: string }>
) => {
  const { app } = await params
  const userId = getUserId(req)
  if (!userId) return unauthorized()
  const settings = await getAppsUserSettings(userId, app)
  const body = (await req.json()) as Record<string, any>
  const newSettings: UserAppSettings = {
    settings: {
      ...settings?.settings,
      ...body,
    },
    app,
    userId,
  }
  await updateAppsUserSettings(userId, app, newSettings)
  return success(newSettings)
}
