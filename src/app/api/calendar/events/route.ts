import { getCalendarEvents } from "@/server/services/calendar.service"
import {
  getUserId,
  success,
  unauthorized,
} from "@/server/services/request.service"
import { NextRequest } from "next/server"

export const GET = async (req: NextRequest) => {
  const userId = getUserId(req)
  if (!userId) return unauthorized()

  const events = await getCalendarEvents(userId)

  return success(events)
}
