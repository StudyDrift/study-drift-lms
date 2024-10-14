import { getAppVersion } from "@/server/services/install.service"
import { failure, success } from "@/server/services/request.service"
import { NextRequest } from "next/server"

export const GET = async (req: NextRequest) => {
  const scope = req.nextUrl.searchParams.get("scope")
  if (scope === "app") {
    const version = await getAppVersion()
    return success(version)
  }

  return failure("Scope not supported")
}
