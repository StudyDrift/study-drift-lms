export interface Message {
  content: string
  role: "user" | "assistant" | "system"
}

export interface ChatSession {
  id: string
  context: string
  messages: Message[]
}

export interface SystemPrompt {
  id: string
  name: string
  content: string
}
