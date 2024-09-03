import { ChatBubbleLeftEllipsisIcon } from "@heroicons/react/24/solid"
import {
  List,
  ListItem,
  ListItemPrefix,
  Typography,
} from "@material-tailwind/react"
import Link from "next/link"

interface Props {
  listItemClassName?: string
}

export const SideNavBottom = ({ listItemClassName }: Props) => {
  const bottomMenuItems = [
    {
      name: "Help & Support",
      icon: <ChatBubbleLeftEllipsisIcon className="h-5 w-5" />,
      href: "/help",
    },
  ]

  return (
    <List>
      {bottomMenuItems.map((item, index) => (
        <Link key={index} href={item.href}>
          <ListItem className={listItemClassName} ripple={false}>
            <ListItemPrefix>{item.icon}</ListItemPrefix>
            <Typography className="mr-auto font-normal text-inherit">
              {item.name}
            </Typography>
          </ListItem>
        </Link>
      ))}
    </List>
  )
}
