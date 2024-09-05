import { useGetAllContentTypesQuery } from "@/redux/services/content-type.api"
import { useCreateContentItemMutation } from "@/redux/services/content.api"
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  Input,
  Option,
  Select,
  Typography,
} from "@material-tailwind/react"
import { useParams } from "next/navigation"
import { useState } from "react"
import { getIcon } from "../icons"
import { Skeleton } from "../ui/skeleton"

interface Props {
  isOpen: boolean
  onClose: () => void
  moduleId: string
}

export const CreateContentItemDialog = ({
  isOpen,
  onClose,
  moduleId,
}: Props) => {
  const { courseId } = useParams<{ courseId: string }>()
  const [name, setName] = useState("")
  const [contentType, setContentType] = useState("content")

  const { data: contentTypes, isLoading: isLoadingContentTypes } =
    useGetAllContentTypesQuery(courseId, {
      skip: !courseId,
    })

  const [createContentItem, { isLoading: isCreating }] =
    useCreateContentItemMutation()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    await createContentItem({
      name,
      description: "",
      body: "",
      meta: {},
      settings: {
        dates: {},
      },

      contentTypeId: contentType,
      courseId,
      contentModuleId: moduleId,
    })

    setName("")
    setContentType("content")

    onClose()
  }

  const getOptionIcon = (icon: string) => {
    const Icon = getIcon(icon)
    return <Icon className="h-4 w-4" />
  }

  return (
    <Dialog open={isOpen} handler={onClose}>
      <DialogHeader>Create Content Item</DialogHeader>
      <DialogBody>
        <Typography>
          Create new content items. These can be learning activities,
          assessments, links, or external applications.
        </Typography>
        <form onSubmit={handleSubmit} className="mt-4 grid gap-4">
          {isLoadingContentTypes ? (
            <Skeleton className="w-full h-6" />
          ) : (
            <Select
              label="Content Type"
              className="w-full"
              value={contentType}
              onChange={(e) => setContentType(e + "")}
            >
              {contentTypes?.map((item) => (
                <Option key={item.id} value={item.id}>
                  <div className="flex flex-row gap-3 items-center">
                    {getOptionIcon(item.icon)}
                    <span>{item.name}</span>
                  </div>
                </Option>
              ))}
            </Select>
          )}
          <Input
            label="Content Item Name"
            className="w-full"
            value={name}
            onChange={(e) => setName(e.target.value)}
            crossOrigin={"anonymous"}
            autoFocus
          />
        </form>
      </DialogBody>
      <DialogFooter>
        <Button variant="text" color="red" onClick={onClose} className="mr-1">
          <span>Cancel</span>
        </Button>
        <Button color="green" onClick={handleSubmit} loading={isCreating}>
          <span>Confirm</span>
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
