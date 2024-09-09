import { ContentItem } from "@/models/content.model"
import { useUpdateContentItemMutation } from "@/redux/services/content.api"
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  Input,
} from "@material-tailwind/react"
import { useParams } from "next/navigation"
import { useState } from "react"

interface Props {
  item: ContentItem
  isOpen: boolean
  onClose: () => void
}

export const RenameContentItemDialog = ({ item, isOpen, onClose }: Props) => {
  const [name, setName] = useState(item.name)
  const { courseId } = useParams<{ courseId: string }>()
  const [updateItem, { isLoading: isUpdatingItem }] =
    useUpdateContentItemMutation()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await updateItem({
      id: item.id,
      courseId: courseId,
      contentItem: {
        ...item,
        name: name,
      },
    })

    setName("")
    onClose()
  }

  return (
    <Dialog open={isOpen} handler={onClose}>
      <DialogHeader>Rename "{item.name}"</DialogHeader>
      <DialogBody>
        <form onSubmit={handleSubmit}>
          <Input
            label="New Content Item Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full"
            crossOrigin={"anonymous"}
            autoFocus
          />
        </form>
      </DialogBody>
      <DialogFooter className="space-x-2">
        <Button variant="text" onClick={onClose}>
          Close
        </Button>
        <Button
          variant="gradient"
          color="green"
          onClick={handleSubmit}
          loading={isUpdatingItem}
        >
          Save
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
