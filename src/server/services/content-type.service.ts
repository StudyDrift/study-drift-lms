import { ContentType } from "@/models/content.model"
import { getCollection } from "./database.service"

const DEFAULT_CONTENT_TYPES: ContentType[] = [
  {
    id: "content",
    name: "Content",
    description:
      "Learning activities, assessments, links, or external applications",
    icon: "DocumentIcon",
    meta: {},
  },
  {
    id: "heading",
    name: "Heading",
    description: "Heading",
    icon: "HeadingIcon",
    meta: {},
  },
  {
    id: "link",
    name: "Link",
    description: "Link to an external application",
    icon: "LinkIcon",
    meta: {},
  },
  {
    id: "quiz",
    name: "Quiz",
    description: "Quiz",
    icon: "QuestionMarkIcon",
    meta: {},
  },
  {
    id: "assignment",
    name: "Assignment",
    description: "Assignment",
    icon: "ListCheckIcon",
    meta: {},
  },
]

const initContentTypes = async () => {
  const collection = await getCollection<ContentType>("contentTypes")

  for (const contentType of DEFAULT_CONTENT_TYPES) {
    await collection.updateOne(
      { id: contentType.id },
      { $set: contentType },
      { upsert: true }
    )
  }
}

export const getAllContentTypes = async () => {
  await initContentTypes()
  const collection = await getCollection<ContentType>("contentTypes")
  return await collection.find({}, { projection: { _id: 0 } }).toArray()
}
