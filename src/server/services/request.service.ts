import { getClaimsFromToken } from "@/lib/jwt"
import { Permission } from "@/models/permissions/permissions.model"
import { RequestParams } from "@/models/request.model"
import { NextRequest, NextResponse } from "next/server"
import { getUserPermissions } from "./permission.service"

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

type Callback = (req: NextRequest, params: RequestParams<any>) => any

export const withPermission = (permission: Permission, callback: Callback) => {
  return async (
    req: NextRequest,
    requestParams: RequestParams<{ courseId: string }> = {
      params: { courseId: "" },
    }
  ) => {
    const userId = getUserId(req)
    if (!userId) return unauthorized()

    const userPermissions = await getUserPermissions(userId, {
      courseId: requestParams.params?.courseId,
    })

    if (userPermissions.includes(permission)) {
      return callback(req, requestParams)
    }

    return unauthorized()
  }
}

export const getIPAddress = (req: NextRequest) => {
  return req.headers.get("x-forwarded-for") || req.ip
}
