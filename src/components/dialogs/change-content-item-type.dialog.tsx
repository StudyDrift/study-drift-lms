import { ContentItem } from "@/models/content.model"
import { useGetAllContentTypesQuery } from "@/redux/services/content-type.api"
import { useUpdateContentItemMutation } from "@/redux/services/content.api"
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
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
  item?: ContentItem
}

export const ChangeContentItemTypeDialog = ({
  isOpen,
  onClose,
  item,
}: Props) => {
  const { courseId } = useParams<{ courseId: string }>()
  const [contentType, setContentType] = useState(
    item?.contentTypeId || "content"
  )

  const { data: contentTypes, isLoading: isLoadingContentTypes } =
    useGetAllContentTypesQuery(courseId, {
      skip: !courseId,
    })

  const [updateItem, { isLoading: isUpdatingItem }] =
    useUpdateContentItemMutation()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!item) return

    await updateItem({
      id: item.id,
      courseId: courseId,
      contentItem: {
        ...item,
        contentTypeId: contentType,
      },
    })

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
        </form>
      </DialogBody>
      <DialogFooter>
        <Button variant="text" color="red" onClick={onClose} className="mr-1">
          <span>Cancel</span>
        </Button>
        <Button color="green" onClick={handleSubmit} loading={isUpdatingItem}>
          <span>Update</span>
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
