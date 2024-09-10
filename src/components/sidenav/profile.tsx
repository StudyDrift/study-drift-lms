"use client"
import { selectUser } from "@/redux/slices/auth.slice"
import { ArrowLeftStartOnRectangleIcon } from "@heroicons/react/16/solid"
import { CogIcon, UserIcon } from "@heroicons/react/24/solid"
import {
  Accordion,
  AccordionBody,
  Avatar,
  ListItem,
  ListItemPrefix,
  Typography,
} from "@material-tailwind/react"
import { ChevronDownIcon } from "lucide-react"
import Link from "next/link"
import { useSelector } from "react-redux"

interface Props {
  isOpen: boolean
  onToggle: () => void
  listItemClassName?: string
}

export const SideNavProfile = ({
  isOpen,
  onToggle,
  listItemClassName,
}: Props) => {
  const user = useSelector(selectUser)

  const profileItems = [
    {
      name: "Profile",
      icon: <UserIcon className="h-5 w-5" />,
      href: "/profile",
    },
    {
      name: "Settings",
      icon: <CogIcon className="h-5 w-5" />,
      href: "/profile/settings",
    },
    {
      name: "Logout",
      icon: <ArrowLeftStartOnRectangleIcon className="h-5 w-5" />,
      href: "/api/auth/logout",
    },
  ]

  return (
    <Accordion open={isOpen}>
      <ListItem
        selected={isOpen}
        data-selected={isOpen}
        onClick={onToggle}
        className={listItemClassName}
        ripple={false}
      >
        <ListItemPrefix>
          <Avatar
            size="sm"
            src="https://www.material-tailwind.com/img/avatar1.jpg"
          />
        </ListItemPrefix>
        <Typography className="mr-auto font-normal text-inherit">
          {user?.first} {user?.last}
        </Typography>
        <ChevronDownIcon
          strokeWidth={3}
          className={`ml-auto h-4 w-4 text-gray-500 transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </ListItem>
      <AccordionBody className="py-1">
        {profileItems.map((item, index) => (
          <Link key={index} href={item.href}>
            <ListItem className={listItemClassName} ripple={false}>
              <ListItemPrefix>{item.icon}</ListItemPrefix>
              <Typography className="mr-auto font-normal text-inherit">
                {item.name}
              </Typography>
            </ListItem>
          </Link>
        ))}
      </AccordionBody>
    </Accordion>
  )
}
