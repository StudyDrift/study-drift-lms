import { Message as ChatMessage } from "@/models/ai.model"
import { Typography } from "@material-tailwind/react"
import Markdown from "react-markdown"
import rehypeRaw from "rehype-raw"
import remarkGfm from "remark-gfm"
import PrismLoader from "../prism/prism-loader"

interface Props {
  message: ChatMessage
  isLoading?: boolean
}

export const Message = ({ message, isLoading }: Props) => {
  return (
    <div className={message.role === "user" ? "self-end" : "self-start"}>
      <Typography
        variant="small"
        color={message.role === "user" ? "blue-gray" : "gray"}
        className="ml-2"
      >
        {message.role === "user" ? "You" : "AI Tutor"}
      </Typography>
      <div
        className={`px-4 py-0.5 rounded-xl text-sm ${
          message.role === "user"
            ? "bg-blue-500 text-white"
            : "bg-gray-300 text-black"
        }`}
      >
        {isLoading ? (
          <div className="animate-pulse flex flex-row">
            <div className="h-3 w-3 m-1 my-2 bg-gray-500 rounded-full duration-200"></div>
            <div className="h-3 w-3 m-1 my-2 bg-gray-500 rounded-full delay-200 duration-200"></div>
            <div className="h-3 w-3 m-1 my-2 bg-gray-500 rounded-full delay-400 duration-200"></div>
          </div>
        ) : (
          <Markdown
            className="prose"
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeRaw]}
          >
            {message.content}
          </Markdown>
        )}
      </div>
      <PrismLoader />
    </div>
  )
}
