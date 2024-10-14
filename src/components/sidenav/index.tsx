"use client"
import { useGetAppVersionQuery } from "@/redux/services/app.api"
import { setIsCommandsVisible } from "@/redux/slices/commands.slice"
import { Card, List, Typography } from "@material-tailwind/react"
import Image from "next/image"
import Link from "next/link"
import { useState } from "react"
import { useDispatch } from "react-redux"
import { ScrollArea } from "../ui/scroll-area"
import { SideNavApps } from "./apps"
import { SideNavBottom } from "./bottom"
import { SideNavCourse } from "./course"
import { SideNavCourses } from "./courses"
import { SideNavProfile } from "./profile"

export const SideNav = () => {
  const [open, setOpen] = useState("apps")
  const { data: appVersion } = useGetAppVersionQuery()
  const dispatch = useDispatch()

  const handleOpen = (value: any, force?: boolean) => {
    if (force) setOpen(value)
    else setOpen(open === value ? "" : value)
  }

  const BASE_LIST_ITEM_STYLES = "select-none px-3 py-2"
  const LIGHT_LIST_ITEM_STYLES = `hover:bg-gray-100 focus:bg-gray-100 active:bg-gray-100 hover:text-gray-900 focus:text-gray-900 active:text-gray-900 data-[selected=true]:text-gray-900`
  const DARK_LIST_ITEM_STYLES = `dark:text-white/90 dark:hover:bg-gray-700 dark:focus:bg-gray-700 dark:active:bg-gray-700 dark:hover:text-white dark:focus:text-white dark:active:text-white dark:data-[selected=true]:text-white`

  const LIST_ITEM_STYLES = `${BASE_LIST_ITEM_STYLES} ${LIGHT_LIST_ITEM_STYLES} ${DARK_LIST_ITEM_STYLES}`

  const handleSearch = () => {
    dispatch(setIsCommandsVisible(true))
  }

  return (
    <Card className="h-screen w-full max-w-[20rem] mx-auto p-1 shadow-md fixed bg-white dark:bg-gray-900 rounded-tl-none rounded-bl-none">
      <div className="mb-2 flex items-center gap-4 py-2 px-3">
        <Link href="/">
          <div className="flex gap-2 items-center">
            <Image src="/logo-trimmed.svg" width={64} height={64} alt="logo" />
            <Typography className="text-3xl font-bold text-blue-gray-900 dark:text-white ml-2">
              Study Drift
            </Typography>
          </div>
        </Link>
      </div>
      <div
        onClick={handleSearch}
        className="py-2 px-3 border border-gray-200 rounded-lg flex justify-start items-center font-medium text-xs text-gray-500 hover:text-gray-700 cursor-pointer hover:border-gray-300"
      >
        Search & Commands (cmd+k or ctrl+k)
      </div>
      <hr className="my-2 border-gray-200" />
      <ScrollArea>
        <List>
          <SideNavProfile
            onToggle={() => handleOpen("profile")}
            isOpen={open === "profile"}
            listItemClassName={LIST_ITEM_STYLES}
          />
          <hr className="my-2 border-gray-200" />
          <SideNavApps
            onToggle={() => handleOpen("apps")}
            isOpen={open === "apps"}
            listItemClassName={LIST_ITEM_STYLES}
          />
          <SideNavCourse
            onToggle={() => handleOpen("course")}
            onForceOpen={() => setOpen("course")}
            isOpen={open === "course"}
            listItemClassName={LIST_ITEM_STYLES}
          />
          <SideNavCourses
            onToggle={() => handleOpen("courses")}
            isOpen={open === "courses"}
            listItemClassName={LIST_ITEM_STYLES}
          />
        </List>
        <hr className="my-2 border-gray-200" />
        <SideNavBottom listItemClassName={LIST_ITEM_STYLES} />
        <div className="flex-1"></div>
        <Typography
          variant="small"
          className="mt-5 font-medium text-xs text-gray-500 flex justify-center"
        >
          &copy; Study Drift {new Date().getFullYear()} - v{appVersion}
        </Typography>
      </ScrollArea>
    </Card>
  )
}
