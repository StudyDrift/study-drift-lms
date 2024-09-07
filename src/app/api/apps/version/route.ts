import { success } from "@/server/services/request.service"
import { NextRequest } from "next/server"

export const GET = async (req: NextRequest) => {
  const version = "0.1.0"

  return success({ version })
}
