"use client"
import { ScopedCommand } from "@/components/command-pallete/scoped-command"
import { ContentTypeViewers } from "@/components/content-types/viewers"
import { Restrict } from "@/components/permission/restrict"
import { RootPage } from "@/components/root-page"
import { Skeleton } from "@/components/ui/skeleton"
import { PERMISSION_COURSE_CONTENT_UPDATE } from "@/models/permissions/course.permission"
import { useGetContentItemByIdQuery } from "@/redux/services/content.api"
import { PencilIcon } from "@heroicons/react/24/solid"
import { Button, Typography } from "@material-tailwind/react"
import Link from "next/link"
import { useParams, usePathname } from "next/navigation"

export default function Page() {
  const { courseId, itemId } = useParams<{ courseId: string; itemId: string }>()
  const path = usePathname()
  const { data: contentItem, isLoading } = useGetContentItemByIdQuery(
    {
      contentItemId: itemId as string,
      courseId: courseId as string,
    },
    {
      skip: !itemId || !courseId,
    }
  )

  return (
    <RootPage
      title={contentItem?.name}
      actions={[
        <Restrict permission={PERMISSION_COURSE_CONTENT_UPDATE} key="edit">
          <ScopedCommand
            command={{
              id: "Edit Page",
              name: "Edit Page",
              group: "Page Actions",
              actionType: "link",
              action: path + "/edit",
            }}
          >
            <Link href={path + "/edit"}>
              <Button className="flex items-center gap-2">
                <PencilIcon className="w-4 h-4" /> Edit
              </Button>
            </Link>
          </ScopedCommand>
        </Restrict>,
      ]}
    >
      {isLoading && <Skeleton className="w-full h-10 mt-8" />}
      {contentItem && (
        <div className="flex flex-col gap-4 mt-8">
          <Typography className="w-full">{contentItem.description}</Typography>
          <ContentTypeViewers item={contentItem} />
        </div>
      )}
    </RootPage>
  )
}
