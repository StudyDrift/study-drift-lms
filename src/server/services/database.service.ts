import { Db, MongoClient, MongoClientOptions } from "mongodb"
import { getEnv } from "../utils/env"

let db: Db | null = null

const createDb = async () => {
  if (db) {
    return
  }

  const uri = getEnv("MONGO_CONNECTION_STRING", true)
  const options: MongoClientOptions = {}

  if (!uri) {
    throw new Error("Add Mongo URI to .env.local")
  }

  const client = new MongoClient(uri, options)
  db = (await client.connect()).db(getEnv("DATABASE_NAME", true))
}

export async function getCollection<T extends Object>(name: string) {
  await createDb()

  if (!db) {
    throw new Error("Database not initialized")
  }

  return db.collection<T>(name)
}
