import { CreateOutcomePayload } from "@/models/outcome.model"
import {
  createOutcome,
  createOutcomes,
} from "@/server/services/outcome.service"
import { success, toJson } from "@/server/services/request.service"
import { NextRequest } from "next/server"

export const POST = async (req: NextRequest) => {
  const body = await toJson<CreateOutcomePayload | CreateOutcomePayload[]>(req)

  if (Array.isArray(body)) {
    const outcomes = await createOutcomes(body)
    return success(outcomes)
  } else {
    const outcome = await createOutcome(body)
    return success([outcome])
  }
}
