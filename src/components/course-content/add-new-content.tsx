import { PERMISSION_COURSE_CONTENT_CREATE } from "@/models/permissions/course.permission"
import { ListItem } from "@material-tailwind/react"
import { PlusIcon } from "lucide-react"
import { useState } from "react"
import { CreateContentItemDialog } from "../dialogs/create-content-item.dialog"
import { Restrict } from "../permission/restrict"

interface Props {
  moduleId: string
  itemCount: number
}

export const AddNewContent = ({ moduleId, itemCount }: Props) => {
  const [addItemOpen, setAddItemOpen] = useState(false)

  return (
    <Restrict permission={PERMISSION_COURSE_CONTENT_CREATE}>
      <ListItem
        onClick={() => setAddItemOpen(true)}
        className="flex flex-row gap-2 items-center justify-center rounded-md p-2 bg-gray-200 text-gray-900 dark:bg-gray-700 dark:text-gray-300"
        ripple={false}
      >
        <PlusIcon className="h-4 w-4 mr-2" />
        Add New Content
      </ListItem>
      <CreateContentItemDialog
        isOpen={addItemOpen}
        onClose={() => setAddItemOpen(false)}
        moduleId={moduleId}
        itemCount={itemCount}
      />
    </Restrict>
  )
}
