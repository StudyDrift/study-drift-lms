"use client"
import { useRestrictions } from "@/hooks/use-restrictions.hook"
import { Permission } from "@/models/permissions/permissions.model"
import { Typography } from "@material-tailwind/react"
import React, { PropsWithChildren } from "react"
import { ScrollArea } from "../ui/scroll-area"
import { Skeleton } from "../ui/skeleton"

interface PageProps extends PropsWithChildren {
  title?: string
  actions?: React.ReactNode[]
  permission?: Permission
  isLoading?: boolean
}

export const RootPage = ({
  children,
  title,
  permission,
  isLoading = false,
  actions = [],
}: PageProps) => {
  useRestrictions(permission)

  return (
    <div className="bg-gray-100/60 pb-24 dark:bg-gray-900/75">
      <main className="pl-[21rem] py-4 pr-4 flex-1 w-screen">
        {title && (
          <div className="flex justify-between flex-row w-full">
            <Typography variant="h3" className="flex-1">
              {title}
            </Typography>
            <div className="flex gap-2">{actions}</div>
          </div>
        )}
        <ScrollArea>
          <div className="mb-16">{!isLoading && children}</div>
        </ScrollArea>
        {isLoading && (
          <div className="flex flex-col gap-2 mt-4">
            <Skeleton className="w-1/3 h-3" />
            <Skeleton className="w-full h-3" />
            <Skeleton className="w-full h-3" />
            <Skeleton className="w-full h-20" />
          </div>
        )}
      </main>
    </div>
  )
}
