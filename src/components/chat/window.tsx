import { ChatSession } from "@/models/ai.model"
import { useGetCompletionMutation } from "@/redux/services/ai.api"
import { PaperAirplaneIcon } from "@heroicons/react/24/solid"
import { Card, IconButton } from "@material-tailwind/react"
import { nanoid } from "nanoid"
import { useState } from "react"
import { ScrollArea } from "../ui/scroll-area"
import { Message } from "./message"

export const Window = () => {
  const [session, setSession] = useState<ChatSession>({
    id: nanoid(),
    context: "course:tutor",
    messages: [],
  })

  const [prompt, setPrompt] = useState("")

  const [getChatCompletion, { isLoading: isGenerating }] =
    useGetCompletionMutation()

  const handlePromptSubmit = async () => {
    if (!prompt) return

    const newSession: ChatSession = {
      ...session,
      messages: [...session.messages, { role: "user", content: prompt }],
    }

    setSession(newSession)
    setPrompt("")

    const completion = await getChatCompletion(newSession)

    if (completion && !completion.error) {
      setSession(completion.data)
    }
  }

  return (
    <div className="w-full mt-4 -mb-16">
      <ScrollArea className="h-[calc(100vh-15rem)] bg-white p-4 rounded-lg shadow">
        <div className="flex flex-col gap-4">
          {session.messages.map((message, index) => (
            <Message key={index} message={message} />
          ))}
          {isGenerating && (
            <Message
              message={{
                role: "assistant",
                content: "",
              }}
              isLoading={true}
            />
          )}
        </div>
      </ScrollArea>
      <Card className="mt-4">
        <textarea
          className="w-full h-24 p-3 resize-none border-2 border-gray-300 rounded-lg outline-none focus:border-blue-200 focus:shadow-lg transition-all"
          placeholder="Ask me anything... (shift+enter to send)"
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.shiftKey) {
              e.preventDefault()
              handlePromptSubmit()
            }
          }}
          onChange={(e) => setPrompt(e.target.value)}
          value={prompt}
          disabled={isGenerating}
          autoFocus
        ></textarea>
        <div className="absolute bottom-3 right-3">
          <IconButton
            className="rounded-full"
            color="blue"
            ripple={false}
            onClick={handlePromptSubmit}
            disabled={isGenerating}
          >
            <PaperAirplaneIcon className="w-6 h-6" />
          </IconButton>
        </div>
      </Card>
    </div>
  )
}
