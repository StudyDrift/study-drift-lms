import { useCheckPermission } from "@/hooks/use-restrictions.hook"
import { ContentModule } from "@/models/content.model"
import {
  PERMISSION_COURSE_CONTENT_DELETE,
  PERMISSION_COURSE_CONTENT_UPDATE,
} from "@/models/permissions/course.permission"
import { useDeleteContentModuleMutation } from "@/redux/services/content.api"
import {
  EllipsisVerticalIcon,
  PencilIcon,
  RocketLaunchIcon,
  TrashIcon,
} from "@heroicons/react/24/solid"
import {
  IconButton,
  List,
  ListItem,
  Menu,
  MenuHandler,
  MenuItem,
  MenuList,
  Typography,
} from "@material-tailwind/react"
import Link from "next/link"
import { useState } from "react"
import { AreYouSureDialog } from "../dialogs/are-you-sure.dialog"
import { RenameModuleDialog } from "../dialogs/rename-module.dialog"
import { Restrict } from "../permission/restrict"

interface Props {
  item: ContentModule
}

export const ContentModuleActions = ({ item }: Props) => {
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  const [deleteModule, { isLoading: isDeleting }] =
    useDeleteContentModuleMutation()

  const [isRenameOpen, setIsRenameOpen] = useState(false)

  const canDelete = useCheckPermission(PERMISSION_COURSE_CONTENT_DELETE)

  const handleModuleDelete = async () => {
    await deleteModule({
      courseId: item.courseId,
      moduleId: item.id,
    })
    setIsDeleteOpen(false)
  }

  return (
    <Restrict permission={PERMISSION_COURSE_CONTENT_UPDATE}>
      <AreYouSureDialog
        isOpen={isDeleteOpen}
        onClose={() => setIsDeleteOpen(false)}
        onConfirm={handleModuleDelete}
        isConfirmLoading={isDeleting}
      >
        <Typography variant="h6">
          Are you sure that you want to delete "{item.name}" along with the
          following content items? This action cannot be undone.
        </Typography>
        <List>
          {item.children?.map((i) => (
            <Link href={`/courses/${item.courseId}/content/${i.id}`} key={i.id}>
              <ListItem key={i.id} className="p-1 px-2">
                <Typography>{i.name}</Typography>
              </ListItem>
            </Link>
          ))}
        </List>
      </AreYouSureDialog>
      <RenameModuleDialog
        isOpen={isRenameOpen}
        onClose={() => setIsRenameOpen(false)}
        item={item}
      />
      <Menu placement="bottom-end">
        <MenuHandler>
          <IconButton variant="text" size="sm">
            <EllipsisVerticalIcon className="h-4 w-4" />
          </IconButton>
        </MenuHandler>
        <MenuList>
          <MenuItem className="flex flex-row gap-2">
            <RocketLaunchIcon className="h-4 w-4" /> Publish
          </MenuItem>
          <MenuItem
            className="flex flex-row gap-2"
            onClick={() => setIsRenameOpen(true)}
          >
            <PencilIcon className="h-4 w-4" /> Rename
          </MenuItem>
          {canDelete && (
            <MenuItem
              className="flex flex-row gap-2"
              onClick={() => setIsDeleteOpen(true)}
            >
              <TrashIcon className="h-4 w-4" /> Delete
            </MenuItem>
          )}
        </MenuList>
      </Menu>
    </Restrict>
  )
}
