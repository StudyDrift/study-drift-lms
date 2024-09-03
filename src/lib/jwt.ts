import { User } from "@/models/user.model"
import { getEnv } from "@/server/utils/env"
import * as jose from "jose"

export const getClaimsFromToken = (token: string) => {
  if (!token) {
    return
  }
  const claims = jose.decodeJwt(token) as jose.JWTPayload & { user: User }

  return claims
}

export const validateToken = async (token: string) => {
  try {
    const secretKey = getEnv("AUTH_SECRET_KEY", true)!
    const secret = jose.base64url.decode(secretKey)
    const decoded = await jose.jwtDecrypt(token, secret)
    const claims = decoded.payload as jose.JWTPayload & { user: User }
    return claims
  } catch (e) {
    return false
  }
}
