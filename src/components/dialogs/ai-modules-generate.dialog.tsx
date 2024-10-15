import { ChatSession } from "@/models/ai.model"
import { ContentModule } from "@/models/content.model"
import { useGetCompletionMutation } from "@/redux/services/ai.api"
import {
  useCreateContentItemMutation,
  useCreateModuleMutation,
} from "@/redux/services/content.api"
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
import { useParams } from "next/navigation"
import { useRef, useState } from "react"
import Markdown from "react-markdown"
import { ScrollArea } from "../ui/scroll-area"

interface Props {
  isOpen: boolean
  onClose: () => void
}

export const GenerateAIModulesDialog = ({ isOpen, onClose }: Props) => {
  const session = useRef<ChatSession>({
    id: nanoid(),
    context: "Course Content",
    messages: [],
  })

  const { courseId } = useParams<{ courseId: string }>()

  const [response, setResponse] = useState("")
  const [prompt, setPrompt] = useState(
    "I am teaching a course about javascript in the web browser"
  )
  const [getChatCompletion, { isLoading: isGenerating }] =
    useGetCompletionMutation()

  const [createModule, { isLoading: isCreatingModule }] =
    useCreateModuleMutation()

  const [createContentItem, { isLoading: isCreatingContentItem }] =
    useCreateContentItemMutation()

  const handleGenerate = async () => {
    session.current.messages.push({ role: "user", content: prompt })
    const completion = await getChatCompletion(session.current)

    if (completion && !completion.error) {
      session.current = completion.data

      setResponse(
        session.current.messages[session.current.messages.length - 1].content
      )
    }
  }

  const onConfirm = async () => {
    const lastMessage = response
    try {
      const json = JSON.parse(lastMessage)

      if (Array.isArray(json.modules)) {
        const courseModules: ContentModule[] = []

        const modulePromises = json.modules.map((m: any, order: number) =>
          createModule({
            name: m.moduleName,
            courseId,
            description: "",
            meta: {},
            outcomeIds: [],
            order,
            children: [],
          }).then((m) => {
            if (m.data) {
              courseModules.push(m.data)
            }
          })
        )

        const contentItemPromises = []

        await Promise.all(modulePromises)

        for (const mod of json.modules) {
          const courseModule = courseModules.find(
            (m) => m.name === mod.moduleName
          )

          if (!courseModule) {
            continue
          }

          for (const item of mod.contentItems) {
            contentItemPromises.push(
              createContentItem({
                contentModuleId: courseModule.id,
                meta: {},
                name: item.name,
                body: "",
                description: "",
                settings: {
                  dates: {},
                },
                courseId,
                order: mod.contentItems.indexOf(item),
                contentTypeId: item.type,
              })
            )
          }
        }

        await Promise.all(contentItemPromises)
      }

      onClose()
    } catch (error) {
      // FIXME: Handle error
      console.error(error)
    }
  }

  return (
    <Dialog open={isOpen} handler={onClose}>
      <DialogHeader>AI Course Structure Generation</DialogHeader>
      <DialogBody>
        <ScrollArea className="max-h-96 h-96">
          <Typography variant="small" color="gray" className="mb-4">
            You can use AI to generate course structure. Simply instruct it as
            to what the course content is, any patterns you want it to follow,
            and click create. Putting in the syllabus is also a great way to
            generate better content.
          </Typography>
          <Markdown className="prose">
            {"```json\n" + response + "\n```"}
          </Markdown>
          <Textarea
            label="Prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </ScrollArea>
      </DialogBody>
      <DialogFooter>
        <Button variant="text" color="red" onClick={onClose} className="mr-1">
          <span>Cancel</span>
        </Button>
        <Button color="blue" loading={isGenerating} onClick={handleGenerate}>
          {response ? <span>Regenerate</span> : <span>Generate</span>}
        </Button>
        {response && (
          <Button
            color="green"
            loading={isCreatingModule || isCreatingContentItem}
            onClick={onConfirm}
            className="ml-1"
          >
            <span>Confirm</span>
          </Button>
        )}
      </DialogFooter>
    </Dialog>
  )
}
