import { PERMISSION_COURSE_CONTENT_UPDATE } from "@/models/permissions/course.permission"
import { usePublishContentItemMutation } from "@/redux/services/content.api"
import { EyeSlashIcon } from "@heroicons/react/24/outline"
import { IconButton } from "@material-tailwind/react"
import { EyeIcon } from "lucide-react"
import { Restrict } from "../permission/restrict"

interface Props {
  contentItemId: string
  courseId: string
  isPublished: boolean
}

export const PublishContentItem = ({
  contentItemId,
  courseId,
  isPublished,
}: Props) => {
  const [togglePublish, { isLoading: isPublishing }] =
    usePublishContentItemMutation()

  return (
    <Restrict permission={PERMISSION_COURSE_CONTENT_UPDATE}>
      <IconButton
        ripple={false}
        variant="text"
        size="sm"
        onClick={() => {
          togglePublish({
            contentItemId,
            courseId,
            isPublished: !isPublished,
          })
        }}
        disabled={isPublishing}
      >
        {isPublished ? (
          <EyeIcon className="h-4 w-4 text-green-500" />
        ) : (
          <EyeSlashIcon className="h-4 w-4" />
        )}
      </IconButton>
    </Restrict>
  )
}
