"use client"
import { RootPage } from "@/components/root-page"
import { Skeleton } from "@/components/ui/skeleton"
import { useGetContentItemByIdQuery } from "@/redux/services/content.api"
import { useParams } from "next/navigation"

export default function Page() {
  const { courseId, itemId } = useParams<{ courseId: string; itemId: string }>()
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
    <RootPage title={contentItem?.name}>
      {isLoading && <Skeleton className="w-full h-10" />}
    </RootPage>
  )
}
