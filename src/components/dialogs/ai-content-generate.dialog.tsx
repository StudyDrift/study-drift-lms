import { ChatSession } from "@/models/ai.model"
import { useGetCompletionMutation } from "@/redux/services/ai.api"
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  Textarea,
  Typography,
} from "@material-tailwind/react"
import { nanoid } from "nanoid"
import { useEffect, useRef, useState } from "react"
import { ScrollArea } from "../ui/scroll-area"

interface Props {
  isOpen: boolean
  onClose: (response?: Response) => void
  activityName: string
}

interface Response {
  description: string
  content: string
}

export const GenerateAIContentDialog = ({
  isOpen,
  onClose,
  activityName,
}: Props) => {
  const session = useRef<ChatSession>({
    id: nanoid(),
    context: "course:content",
    messages: [],
  })

  const [prompt, setPrompt] = useState("")
  const [getChatCompletion, { isLoading: isGenerating }] =
    useGetCompletionMutation()

  const isSet = useRef(false)

  useEffect(() => {
    if (!isSet.current && activityName) {
      setPrompt(`Generate student content for ${activityName}.`)

      isSet.current = true
    }
  }, [setPrompt, activityName, isSet])

  const handleGenerate = async () => {
    session.current.messages.push({ role: "user", content: prompt })
    const completion = await getChatCompletion(session.current)

    if (completion && !completion.error) {
      session.current = completion.data

      const res =
        session.current.messages[session.current.messages.length - 1].content

      try {
        const json = JSON.parse(res)
        handleClose(json)
      } catch (error) {
        // FIXME: Handle error
        console.error(error)
      }
    }
  }

  const handleClose = (response?: Response) => {
    setPrompt("")
    isSet.current = false
    onClose(response)
  }

  return (
    <Dialog open={isOpen} handler={handleClose}>
      <DialogHeader>AI Course Content Generation</DialogHeader>
      <DialogBody>
        <ScrollArea>
          <Typography variant="small" color="gray" className="mb-4">
            You can use AI to generate course content. Simply instruct it as to
            what the course content should be, any patterns you want it to
            follow, and click create. Putting in the syllabus is also a great
            way to generate better content.
          </Typography>
          <Textarea
            label="Prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </ScrollArea>
      </DialogBody>
      <DialogFooter>
        <Button
          variant="text"
          color="red"
          onClick={() => handleClose(undefined)}
          className="mr-1"
        >
          <span>Cancel</span>
        </Button>
        <Button color="blue" loading={isGenerating} onClick={handleGenerate}>
          Generate
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
