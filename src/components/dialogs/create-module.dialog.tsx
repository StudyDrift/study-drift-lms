import { useCourseData } from "@/hooks/use-course-data.hooks"
import { Outcome } from "@/models/outcome.model"
import { useCreateModuleMutation } from "@/redux/services/content.api"
import { useGetOutcomesByIdsQuery } from "@/redux/services/outcome.api"
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  IconButton,
  Input,
  List,
  ListItem,
  ListItemPrefix,
  Textarea,
  Typography,
} from "@material-tailwind/react"
import { CircleCheckIcon, CircleIcon } from "lucide-react"
import { useState } from "react"
import { ScrollArea } from "../ui/scroll-area"

interface Props {
  isOpen: boolean
  onClose: () => void
}

export const CreateModuleDialog = ({ isOpen, onClose }: Props) => {
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [selectedOutcomes, setSelectedOutcomes] = useState<Outcome[]>([])

  const { course, isLoading: isCourseLoading } = useCourseData()

  const { data: outcomes, isLoading: isOutcomesLoading } =
    useGetOutcomesByIdsQuery(course?.outcomeIds || [], {
      skip: isCourseLoading,
    })

  const [createModule, { isLoading: isCreatingModule }] =
    useCreateModuleMutation()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    await createModule({
      name,
      description,
      courseId: course?.id || "",
      outcomeIds: selectedOutcomes.map((o) => o.id),
      meta: {},
    })

    setName("")
    setDescription("")
    setSelectedOutcomes([])

    onClose()
  }

  return (
    <Dialog open={isOpen} handler={onClose}>
      <DialogHeader>Create Module</DialogHeader>
      <DialogBody>
        <ScrollArea>
          <Typography variant="small" color="gray" className="mb-4">
            A module is a way to segment content items and activities. Settings,
            such as dates, visibility, and outcomes can be applied to the
            module.
          </Typography>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <Input
              label="Module Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              crossOrigin={"anonymous"}
              autoFocus
            />
            <Textarea
              label="Module Description (Optional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            ></Textarea>
          </form>
          <Typography variant="h5">Outcomes</Typography>
          <Typography variant="small" color="gray" className="mb-4">
            Select the outcome you want to include in this module
          </Typography>
          <List className="m-0 p-0">
            {outcomes?.map((outcome) => (
              <ListItem
                key={outcome.id}
                ripple={false}
                className={
                  selectedOutcomes.includes(outcome)
                    ? " bg-gray-800 text-white focus:bg-gray-800 focus:text-white active:bg-gray-800 active:text-white hover:bg-gray-800 hover:text-white"
                    : ""
                }
                onClick={() => {
                  if (selectedOutcomes.includes(outcome)) {
                    setSelectedOutcomes(
                      selectedOutcomes.filter((o) => o.id !== outcome.id)
                    )
                  } else {
                    setSelectedOutcomes([...selectedOutcomes, outcome])
                  }
                }}
              >
                <ListItemPrefix>
                  <IconButton variant="text">
                    {selectedOutcomes.includes(outcome) ? (
                      <CircleCheckIcon className="h-4 w-4 text-green-500" />
                    ) : (
                      <CircleIcon className="h-4 w-4" />
                    )}
                  </IconButton>
                </ListItemPrefix>
                {outcome.outcome}
              </ListItem>
            ))}
          </List>
        </ScrollArea>
      </DialogBody>
      <DialogFooter>
        <Button variant="text" color="red" onClick={onClose} className="mr-1">
          <span>Cancel</span>
        </Button>
        <Button color="green" onClick={handleSubmit} loading={isCreatingModule}>
          <span>Confirm</span>
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
