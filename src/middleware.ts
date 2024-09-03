import { NextRequest, NextResponse } from "next/server"
import { validateToken } from "./lib/jwt"

const WHITELIST = ["/api/auth/login", "/api/auth/register", "/api/auth/token"]

export async function middleware(req: NextRequest, res: NextResponse) {
  if (
    WHITELIST.includes(req.nextUrl.pathname) ||
    !req.nextUrl.pathname.includes("/api/")
  )
    return

  let token = req.cookies.get("auth")?.value
  if (!token) {
    token = req.headers.get("authentication")?.replace("Bearer ", "")
  }

  const validClaims = validateToken(token + "")
  if (!validClaims) {
    const r = NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    r.cookies.delete("auth")
    return r
  }

  return NextResponse.next()
}
