import { User } from "@/models/user.model"
import { Version } from "@/models/version.model"
import { createCourse } from "./course.service"
import { getCollection } from "./database.service"
import { initPermissions } from "./permission.service"

export const getAppVersion = async () => {
  const collection = await getCollection<Version>("versions")
  const version = await collection.findOne(
    { app: "global" },
    { projection: { _id: 0 } }
  )
  return version
}

export const installApp = async (user: User) => {
  // Setup permissions
  await initPermissions()

  // Create example course
  const course = await createExampleCourse(user)

  const collection = await getCollection<Version>("versions")
  await collection.insertOne({ app: "global", version: "0.1.0" })

  return {
    version: "0.1.0",
  }
}

const createExampleCourse = async (user: User) => {
  const course = await createCourse(
    {
      name: "Example Course",
      description: "This is an example course",
      meta: {},
      code: "example",
      outcomeIds: [],
      settings: {
        dates: {},
      },
    },
    user.id
  )
  return course
}
