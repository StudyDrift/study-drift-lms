import { PasswordAuth } from "@/models/auth.model"
import { User } from "@/models/user.model"
import { getEnv } from "@/server/utils/env"
import bcrypt from "bcrypt"
import * as jose from "jose"
import { getCollection } from "../database.service"

const passwordAuthCollection = async () => {
  return await getCollection<PasswordAuth>("passwordAuths")
}

export const createPasswordAuthRecord = async (payload: PasswordAuth) => {
  payload.password = await hashPassword(payload.password)

  const collection = await passwordAuthCollection()
  await collection.insertOne(payload)
}

export const loginPasswordAuth = async (payload: PasswordAuth) => {
  const collection = await passwordAuthCollection()
  const user = await collection.findOne({
    email: payload.email,
  })

  if (!user) {
    return false
  }

  return await checkPassword(payload.password, user.password)
}

const checkPassword = async (password: string, dbPassword: string) => {
  return await bcrypt.compare(password, dbPassword)
}

const hashPassword = async (password: string) => {
  const salt = await bcrypt.genSaltSync(10)
  return await bcrypt.hash(password, salt)
}

export const createToken = async (user: User) => {
  const secretKey = getEnv("AUTH_SECRET_KEY", true)!

  if ((user as any)["_id"]) {
    delete (user as any)["_id"]
  }

  const secret = new TextEncoder().encode(secretKey)

  const alg = "HS256"

  const token = await new jose.SignJWT({ user })
    .setProtectedHeader({ alg })
    .setIssuedAt()
    .setIssuer("studydrift.com")
    .setAudience("studydrift.com")
    .setExpirationTime("12h")
    .sign(secret)

  return token
}
