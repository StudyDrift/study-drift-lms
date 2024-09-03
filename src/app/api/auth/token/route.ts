import { getClaimsFromToken } from "@/lib/jwt"
import { success } from "@/server/services/request.service"
import { NextRequest } from "next/server"

export const GET = async (req: NextRequest) => {
  const token = req.cookies.get("auth")?.value
  const claims = getClaimsFromToken(token!)
  return success({ token, claims })
}
