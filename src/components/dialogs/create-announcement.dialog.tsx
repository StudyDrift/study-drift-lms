import { cn } from "@/lib/utils"
import { useCreateAnnouncementMutation } from "@/redux/services/announcement.api"
import {
  Button,
  Card,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  Input,
  Typography,
} from "@material-tailwind/react"
import { MDXEditorMethods } from "@mdxeditor/editor"
import { format } from "date-fns"
import { CalendarIcon } from "lucide-react"
import { useParams } from "next/navigation"
import { useRef, useState } from "react"
import InitializedMDXEditor from "../editor/InitializedMDXEditor"
import { Calendar } from "../ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover"
import { ScrollArea } from "../ui/scroll-area"

interface Props {
  isOpen: boolean
  onClose: () => void
}

export const CreateAnnouncementDialog = ({ isOpen, onClose }: Props) => {
  const editor = useRef<MDXEditorMethods>(null)
  const { courseId } = useParams<{ courseId: string }>()
  const [content, setContent] = useState("")
  const [title, setTitle] = useState("")
  const [visibilityStartDate, setVisibilityStartDate] = useState<
    Date | undefined
  >(new Date())
  const [visibilityStartTime, setVisibilityStartTime] = useState<string>("")

  const [visibilityEndDate, setVisibilityEndDate] = useState<Date | undefined>(
    undefined
  )
  const [visibilityEndTime, setVisibilityEndTime] = useState<string>("")

  const [createAnnouncement, { isLoading: isCreating }] =
    useCreateAnnouncementMutation()

  const createDateFromDateTime = (date?: Date, time?: string) => {
    if (!date) return

    const newTime = time ? time : "00:00 AM"

    // Time format: hh:mm AM/PM
    const [hours, minutes] = newTime.split(":")
    const [_, ampm] = newTime.split(" ")
    const newDate = date instanceof Date ? date : new Date(date)
    newDate.setHours(Number(hours), Number(minutes.split(" ")[0]), 0, 0)
    if (ampm === "PM") {
      newDate.setHours(newDate.getHours() + 12)
    }
    return newDate.toISOString()
  }

  const handleCreate = async () => {
    await createAnnouncement({
      title,
      content,
      meta: {},
      courseId,
      dates: {
        visibilityStart: createDateFromDateTime(
          visibilityStartDate,
          visibilityStartTime
        ),
        visibilityEnd: createDateFromDateTime(
          visibilityEndDate,
          visibilityEndTime
        ),
      },
    })

    editor.current?.setMarkdown("")
    setTitle("")
    setContent("")
    setVisibilityStartDate(undefined)
    setVisibilityStartTime("")
    setVisibilityEndDate(undefined)
    setVisibilityEndTime("")

    onClose()
  }

  return (
    <Dialog open={isOpen} handler={onClose} size="xl">
      <DialogHeader>Create Announcement</DialogHeader>
      <ScrollArea>
        <DialogBody>
          <Typography variant="h6">Announcement Content</Typography>
          <div className="mb-4">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              label="Announcement Title"
              className="w-full"
              crossOrigin={"anonymous"}
              autoFocus
            />
          </div>
          <Card className="min-h-60">
            <InitializedMDXEditor
              editorRef={editor}
              markdown={content}
              onChange={(body) => setContent(body)}
              contentEditableClassName="prose"
              placeholder="Start typing here..."
              className="min-h-60"
            />
          </Card>
          <div className="mt-4 flex flex-row gap-4">
            <div className="flex flex-col gap-4 ">
              <Typography variant="h6">Visibility Start Date</Typography>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outlined"
                    ripple={false}
                    className={cn(
                      "w-[280px] justify-start text-left font-normal flex items-center",
                      !visibilityStartDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {visibilityStartDate ? (
                      format(visibilityStartDate, "PPP")
                    ) : (
                      <span>Start Visibility Date</span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={visibilityStartDate}
                    onSelect={(date) => {
                      console.log(date)
                      setVisibilityStartDate(date)
                    }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
              <Input
                label="Visibility Start Time"
                value={visibilityStartTime}
                onChange={(e) => setVisibilityStartTime(e.target.value)}
                crossOrigin={"anonymous"}
                placeholder="12:00 PM"
              />
            </div>
            <div className="flex flex-col gap-4">
              <Typography variant="h6">Visibility End Date</Typography>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outlined"
                    ripple={false}
                    className={cn(
                      "w-[280px] justify-start text-left font-normal flex items-center",
                      !visibilityEndDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {visibilityEndDate ? (
                      format(visibilityEndDate, "PPP")
                    ) : (
                      <span>End Visibility Date</span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={visibilityEndDate}
                    onSelect={(date) => setVisibilityEndDate(date)}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
              <Input
                label="Visibility End Time"
                value={visibilityEndTime}
                onChange={(e) => setVisibilityEndTime(e.target.value)}
                crossOrigin={"anonymous"}
                placeholder="12:00 PM"
              />
            </div>
          </div>
        </DialogBody>
        <DialogFooter className="space-x-2">
          <Button variant="text" onClick={onClose}>
            <span>Cancel</span>
          </Button>
          <Button color="green" onClick={handleCreate} loading={isCreating}>
            <span>Create</span>
          </Button>
        </DialogFooter>
      </ScrollArea>
    </Dialog>
  )
}
