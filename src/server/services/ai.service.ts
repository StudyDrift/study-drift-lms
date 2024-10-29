import { ChatSession, Message, SystemPrompt } from "@/models/ai.model"
import { nanoid } from "nanoid"
import { AzureOpenAI } from "openai"
import { getCollection } from "./database.service"

const key = process.env.AZURE_OPENAI_KEY || ""
const endpoint = process.env.AZURE_OPENAI_ENDPOINT || ""
/**
 * Azure OpenAI Model:
 *
 * The purpose of Azure OpenAI is to allow private information
 */
const model = process.env.AZURE_OPENAI_MODEL || ""

const getClient = () => {
  if (!key || !endpoint || !model) {
    return undefined
  }

  const apiVersion = "2024-05-01-preview"
  return new AzureOpenAI({
    apiKey: key,
    endpoint: endpoint,
    deployment: model,
    apiVersion,
  })
}

export const getSystemPrompt = async (key?: string) => {
  if (!key) {
    return {} as SystemPrompt
  }

  const collection = await getCollection<SystemPrompt>("systemPrompts")

  return collection.findOne({ key }) as unknown as SystemPrompt
}

export const createSystemPrompt = async (
  name: string,
  content: string,
  key: string,
  isJson: boolean
) => {
  const collection = await getCollection<SystemPrompt>("systemPrompts")
  await collection.insertOne({ name, content, id: nanoid(), key, isJson })
}

export const getCompletion = async (
  messages: Message[],
  systemPromptName?: string
) => {
  const client = getClient()

  if (!client) {
    return "AI is not currently enabled"
  }

  const systemPrompt = await getSystemPrompt(systemPromptName)

  const response = await client.chat.completions.create({
    model,
    stream: false,
    temperature: 0.7,
    response_format: systemPrompt.isJson ? { type: "json_object" } : undefined,
    messages: [
      {
        role: "system",
        content: systemPrompt?.content || "",
      },
      ...messages.map((x) => ({
        role: x.role,
        content: x.content,
      })),
    ],
  })

  return response.choices[0].message.content
}

export const updateSession = async (session: ChatSession) => {
  const collection = await getCollection<ChatSession>("chatSessions")
  await collection.updateOne(
    { id: session.id },
    { $set: session },
    { upsert: true }
  )
}
