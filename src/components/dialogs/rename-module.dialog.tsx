import { ContentModule } from "@/models/content.model"
import { useUpdateModuleMutation } from "@/redux/services/content.api"
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  Input,
} from "@material-tailwind/react"
import { useState } from "react"

interface Props {
  isOpen: boolean
  onClose: () => void
  item: ContentModule
}

export const RenameModuleDialog = ({ isOpen, onClose, item }: Props) => {
  const [newName, setNewName] = useState(item.name)
  const [updateModule, { isLoading: isUpdating }] = useUpdateModuleMutation()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    await updateModule({
      courseId: item.courseId,
      id: item.id,
      module: {
        ...item,
        name: newName,
      },
    })

    onClose()
  }

  return (
    <Dialog open={isOpen} handler={onClose}>
      <DialogHeader>Rename "{item.name}"</DialogHeader>
      <DialogBody>
        <form onSubmit={handleSubmit}>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            label="New Module Name"
            className="w-full"
            crossOrigin={"anonymous"}
            autoFocus
          />
        </form>
      </DialogBody>
      <DialogFooter>
        <Button variant="text" color="red" onClick={onClose} className="mr-1">
          <span>Cancel</span>
        </Button>
        <Button
          variant="gradient"
          color="green"
          onClick={handleSubmit}
          loading={isUpdating}
        >
          <span>Save</span>
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
