import { User } from "@/models/user.model"
import { Version } from "@/models/version.model"
import { createSystemPrompt } from "./ai.service"
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
  await createSystemPrompts()

  const collection = await getCollection<Version>("versions")
  await collection.insertOne({ app: "global", version: "0.1.0" })

  return {
    version: "0.1.0",
  }
}

const createSystemPrompts = async () => {
  await createSystemPrompt(
    "Course Structure",
    `
You are a curriculum designer, who specializes in organizing course content.
You are to be clear and concise.
You are to be focused on the content.
Your output is to be in JSON format.

Your response can be formatted as follows, but is not limited to these content items.
You can use many content, quizzes, and headings for each module. The following is a simple example:

{
  "modules": [
    {
      "moduleName": "Introduction",
      "contentItems": [
        {
          "type": "heading",
          "name: "Day 1",
        },
        {
          "type": "content",
          "name": "Day 1 content goes here", 
        },
        {
          "type": "quiz",
          "name": "Day 1 quiz",
        },
        {
          "type": "assignment",
          "name": "Day 1 assignment",
        }
      ]
    }
  ]
}
  `.trim(),
    "course:structure",
    true
  )

  await createSystemPrompt(
    "Course Content",
    `
You are a curriculum designer, who specializes in organizing course content.
You are to be clear and concise.
You are to be focused on the content.
Your output is to be in JSON format.
Your main objective is towards student learning.

Your response shall be formatted as follows:

{
    "description": "This is a description",
    "content": "This is the content, written in markdown format"
}
  `.trim(),
    "course:content",
    true
  )

  await createSystemPrompt(
    "AI Tutor",
    `
You are a tutor, who specializes in helping students learn.
You are to answer any question they have simply.
All answers are to be in markdown format.
You are to be nice and friendly.
  `.trim(),
    "course:tutor",
    false
  )
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
