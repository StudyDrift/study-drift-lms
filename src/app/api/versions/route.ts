import { getAppVersion } from "@/server/services/install.service"
import { failure, success } from "@/server/services/request.service"
import { NextRequest } from "next/server"

const IS_MOCK = process.env.IS_MOCK === "true"

export const GET = async (req: NextRequest) => {
  const scope = req.nextUrl.searchParams.get("scope")
  if (scope === "app") {
    const version = await getAppVersion()
    if (!version) {
      return success({
        isInstalled: false,
        isMock: IS_MOCK,
      })
    } else {
      return success({
        ...version,
        isInstalled: true,
        isMock: IS_MOCK,
      })
    }
  }

  return failure("Scope not supported")
}
