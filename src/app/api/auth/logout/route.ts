import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { NextRequest } from "next/server"

export const GET = async (req: NextRequest) => {
  const cookiesContainer = await cookies()
  cookiesContainer.delete("auth")
  return redirect("/auth/login")
}
