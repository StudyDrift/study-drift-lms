import { CreateOutcomePayload } from "@/models/outcome.model"
import { PERMISSION_COURSE_OUTCOMES_CREATE } from "@/models/permissions/course.permission"
import {
  createOutcome,
  createOutcomes,
  getByIds as getOutcomesByIds,
} from "@/server/services/outcome.service"
import {
  success,
  toJson,
  withPermission,
} from "@/server/services/request.service"
import { NextRequest } from "next/server"

export const POST = withPermission(
  PERMISSION_COURSE_OUTCOMES_CREATE,
  async (req: NextRequest) => {
    const body = await toJson<CreateOutcomePayload | CreateOutcomePayload[]>(
      req
    )

    if (Array.isArray(body)) {
      const outcomes = await createOutcomes(body)
      return success(outcomes)
    } else {
      const outcome = await createOutcome(body)
      return success([outcome])
    }
  }
)

export const GET = async (req: NextRequest) => {
  const outcomeIds =
    req.nextUrl.searchParams.get("outcomeIds")?.split(",") || []
  const outcomes = await getOutcomesByIds(outcomeIds)
  return success(outcomes)
}
