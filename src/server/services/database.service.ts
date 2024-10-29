import { Db, MongoClient, MongoClientOptions, ProfilingLevel } from "mongodb"
import { MongoMemoryServer } from "mongodb-memory-server"
import { getEnv } from "../utils/env"

let db: Db | null = null

const IS_MOCK = getEnv("IS_MOCK", false) === "true"

const createDb = async () => {
  if (db) {
    return
  }

  if (IS_MOCK && !(global as any).__MONGOINSTANCE) {
    const instance = await MongoMemoryServer.create()
    const uri = instance.getUri()
    ;(global as any).__MONGOINSTANCE = instance
    process.env.MONGO_CONNECTION_STRING = uri.slice(0, uri.lastIndexOf("/"))
  }

  const uri = getEnv("MONGO_CONNECTION_STRING", true)
  const options: MongoClientOptions = {}

  if (!uri) {
    throw new Error("Add Mongo URI to .env.local")
  }

  const client = new MongoClient(uri, options)
  db = (await client.connect()).db(getEnv("DATABASE_NAME", true))
  db.setProfilingLevel(ProfilingLevel.all)
}

export async function getCollection<T extends Object>(name: string) {
  await createDb()

  if (!db) {
    throw new Error("Database not initialized")
  }

  return db.collection<T>(name)
}
