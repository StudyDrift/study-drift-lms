"use client"
import { useGetAppVersionQuery } from "@/redux/services/app.api"
import { ArrowLeftStartOnRectangleIcon } from "@heroicons/react/24/outline"
import { ChatBubbleLeftEllipsisIcon } from "@heroicons/react/24/solid"
import {
  Card,
  List,
  ListItem,
  ListItemPrefix,
  Typography,
} from "@material-tailwind/react"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { SideNavApps } from "./apps"
import { SideNavCourse } from "./course"
import { SideNavCourses } from "./courses"
import { SideNavProfile } from "./profile"

export const SideNav = () => {
  const [open, setOpen] = useState("apps")
  const { data: appVersion } = useGetAppVersionQuery()
  const router = useRouter()

  const handleOpen = (value: any) => {
    setOpen(open === value ? "" : value)
  }

  const bottomMenuItems = [
    {
      name: "Help & Support",
      icon: <ChatBubbleLeftEllipsisIcon className="h-5 w-5" />,
      onClick: () => router.push("/help"),
    },
    {
      name: "Sign Out",
      icon: <ArrowLeftStartOnRectangleIcon className="h-5 w-5" />,
      onClick: () => router.push("/api/auth/logout"),
    },
  ]

  const LIST_ITEM_STYLES =
    "select-none hover:bg-gray-100 focus:bg-gray-100 active:bg-gray-100 hover:text-gray-900 focus:text-gray-900 active:text-gray-900 data-[selected=true]:text-gray-900 px-3 py-2"

  return (
    <Card className="h-[calc(100vh-1rem)] w-full max-w-[20rem] mx-auto p-1 shadow-md fixed mt-[0.5rem]">
      <div className="mb-2 flex items-center gap-4 py-2 px-3">
        <Typography color="blue-gray" className="text-lg font-bold">
          Study Drift
        </Typography>
      </div>
      <hr className="my-2 border-gray-200" />
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
      <List>
        {bottomMenuItems.map((item, index) => (
          <ListItem
            key={index}
            onClick={item.onClick}
            className={LIST_ITEM_STYLES}
            ripple={false}
          >
            <ListItemPrefix>{item.icon}</ListItemPrefix>
            <Typography className="mr-auto font-normal text-inherit">
              {item.name}
            </Typography>
          </ListItem>
        ))}
      </List>
      <div className="flex flex-1"></div>
      <Typography
        variant="small"
        className="mt-5 font-medium text-xs text-gray-500 flex justify-center"
      >
        &copy; Study Drift {new Date().getFullYear()} - v{appVersion}
      </Typography>
    </Card>
  )
}
