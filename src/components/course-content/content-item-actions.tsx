import { useCheckPermission } from "@/hooks/use-restrictions.hook"
import { ContentItem } from "@/models/content.model"
import {
  PERMISSION_COURSE_CONTENT_DELETE,
  PERMISSION_COURSE_CONTENT_UPDATE,
} from "@/models/permissions/course.permission"
import { useDeleteContentItemMutation } from "@/redux/services/content.api"
import {
  PencilIcon,
  PencilSquareIcon,
  RocketLaunchIcon,
  TrashIcon,
} from "@heroicons/react/24/solid"
import {
  IconButton,
  Menu,
  MenuHandler,
  MenuItem,
  MenuList,
} from "@material-tailwind/react"
import { SwitchIcon } from "@radix-ui/react-icons"
import { EllipsisVerticalIcon } from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import { AreYouSureDialog } from "../dialogs/are-you-sure.dialog"
import { ChangeContentItemTypeDialog } from "../dialogs/change-content-item-type.dialog"
import { RenameContentItemDialog } from "../dialogs/rename-content-item.dialog"
import { Restrict } from "../permission/restrict"

interface Props {
  item: ContentItem
}

export const ContentItemActions = ({ item }: Props) => {
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  const [isChangeTypeOpen, setIsChangeTypeOpen] = useState(false)
  const [isRenameOpen, setIsRenameOpen] = useState(false)
  const [deleteItem, { isLoading: isDeleting }] = useDeleteContentItemMutation()

  const canDelete = useCheckPermission(PERMISSION_COURSE_CONTENT_DELETE)

  const handleDelete = async () => {
    await deleteItem({
      courseId: item.courseId,
      contentItemId: item.id,
    })
    setIsDeleteOpen(false)
  }

  return (
    <Restrict permission={PERMISSION_COURSE_CONTENT_UPDATE}>
      <AreYouSureDialog
        isOpen={isDeleteOpen}
        onClose={() => setIsDeleteOpen(false)}
        onConfirm={handleDelete}
        isConfirmLoading={isDeleting}
      >
        Are you sure that you want to delete {item.name}?
      </AreYouSureDialog>
      <ChangeContentItemTypeDialog
        item={item}
        isOpen={isChangeTypeOpen}
        onClose={() => setIsChangeTypeOpen(false)}
      />
      <RenameContentItemDialog
        item={item}
        isOpen={isRenameOpen}
        onClose={() => setIsRenameOpen(false)}
      />
      <Menu placement="bottom-end">
        <MenuHandler>
          <IconButton ripple={false} variant="text" size="sm">
            <EllipsisVerticalIcon className="h-4 w-4" />
          </IconButton>
        </MenuHandler>
        <MenuList>
          <MenuItem className="flex flex-row gap-2">
            <RocketLaunchIcon className="h-4 w-4" /> Publish
          </MenuItem>
          <Link href={`/courses/${item.courseId}/content/${item.id}/edit`}>
            <MenuItem className="flex flex-row gap-2">
              <PencilIcon className="h-4 w-4" /> Edit
            </MenuItem>
          </Link>
          <MenuItem
            className="flex flex-row gap-2"
            onClick={() => setIsRenameOpen(true)}
          >
            <PencilSquareIcon className="h-4 w-4" /> Rename
          </MenuItem>
          <MenuItem
            className="flex flex-row gap-2"
            onClick={() => setIsChangeTypeOpen(true)}
          >
            <SwitchIcon className="h-4 w-4" /> Change Type
          </MenuItem>
          {canDelete && (
            <MenuItem
              onClick={() => setIsDeleteOpen(true)}
              className="flex flex-row gap-2"
            >
              <TrashIcon className="h-4 w-4" /> Delete
            </MenuItem>
          )}
        </MenuList>
      </Menu>
    </Restrict>
  )
}
