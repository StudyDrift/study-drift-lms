import { getClaimsFromToken } from "@/lib/jwt"
import { NextRequest, NextResponse } from "next/server"

export function toJson<T>(req: NextRequest) {
  return req.json() as Promise<T>
}

export const success = (payload: any) => {
  return NextResponse.json(payload, { status: 200 })
}

export const failure = (payload: any) => {
  return NextResponse.json({ error: payload }, { status: 400 })
}

export const unauthorized = () => {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
}

export const getUserId = (req: NextRequest) => {
  let token = req.cookies.get("auth")?.value
  if (!token) {
    token = req.headers.get("authentication")?.replace("Bearer ", "")
  }

  const claims = getClaimsFromToken(token!)

  return claims?.user.id
}
