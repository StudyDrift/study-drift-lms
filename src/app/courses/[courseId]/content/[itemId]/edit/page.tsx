"use client"
import { ContentTypeEditors } from "@/components/content-types/editors"
import { RootPage } from "@/components/root-page"
import { Skeleton } from "@/components/ui/skeleton"
import { UpdateContentItemPayload } from "@/models/content.model"
import { PERMISSION_COURSE_CONTENT_UPDATE } from "@/models/permissions/course.permission"
import {
  useGetContentItemByIdQuery,
  useUpdateContentItemMutation,
} from "@/redux/services/content.api"
import { EyeIcon, RocketLaunchIcon } from "@heroicons/react/24/solid"
import { Button, Input, Textarea } from "@material-tailwind/react"
import Link from "next/link"
import { useParams, usePathname } from "next/navigation"
import { useEffect, useRef, useState } from "react"

export default function Page() {
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [body, setBody] = useState("")
  const [meta, setMeta] = useState<Record<string, any>>({})

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

  const [updateItem, { isLoading: isUpdating }] = useUpdateContentItemMutation()

  const isSet = useRef(false)

  useEffect(() => {
    if (contentItem && !isSet.current) {
      setName(contentItem.name)
      setDescription(contentItem.description)
      setBody(contentItem.body)
      setMeta(contentItem.meta)
      isSet.current = true
    }
  }, [contentItem])

  const handlePublish = async () => {
    await updateItem({
      courseId: contentItem?.courseId as string,
      id: contentItem?.id as string,
      contentItem: {
        ...contentItem,
        name,
        description,
        body,
        meta,
      } as UpdateContentItemPayload,
    })
  }

  return (
    <RootPage
      permission={PERMISSION_COURSE_CONTENT_UPDATE}
      title={`Edit ${contentItem?.name || ""}`}
      actions={[
        <Link href={path + "/.."} key="preview">
          <Button className="flex items-center gap-2" variant="outlined">
            <EyeIcon className="w-4 h-4" /> Preview
          </Button>
        </Link>,
        <Button
          color="blue"
          className="flex items-center gap-2"
          key="publish"
          onClick={handlePublish}
          loading={isUpdating}
        >
          <RocketLaunchIcon className="w-4 h-4" /> Publish
        </Button>,
      ]}
    >
      {isLoading && <Skeleton className="w-full h-10 mt-8" />}
      {!isLoading && isSet.current && contentItem && (
        <div className="flex flex-col gap-2 mt-8">
          <Input
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full"
            crossOrigin={"anonymous"}
          />
          <Textarea
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full"
          ></Textarea>
          <ContentTypeEditors
            item={{
              ...contentItem,
              name,
              description,
              body,
              meta,
            }}
            onChange={(item) => {
              setBody(item.body)
              setMeta(item.meta)
            }}
          />
        </div>
      )}
    </RootPage>
  )
}
