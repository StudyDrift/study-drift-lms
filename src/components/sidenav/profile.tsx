import { selectUser } from "@/redux/slices/auth.slice"
import {
  Accordion,
  AccordionBody,
  Avatar,
  ListItem,
  ListItemPrefix,
  Typography,
} from "@material-tailwind/react"
import { ChevronDownIcon, List } from "lucide-react"
import router from "next/router"
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

  return (
    <Accordion open={isOpen}>
      <ListItem
        selected={isOpen}
        data-selected={isOpen}
        onClick={onToggle}
        className="px-3 py-2 select-none hover:bg-gray-100 focus:bg-gray-100 active:bg-gray-100 hover:text-gray-900 focus:text-gray-900 active:text-gray-900 data-[selected=true]:text-gray-900"
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
        <List className="p-0">
          <ListItem
            className={`px-16 ${listItemClassName}`}
            onClick={() => router.push("/profile")}
            ripple={false}
          >
            My Profile
          </ListItem>
          <ListItem
            className={`px-16 ${listItemClassName}`}
            onClick={() => router.push("/profile/settings")}
            ripple={false}
          >
            Settings
          </ListItem>
        </List>
      </AccordionBody>
    </Accordion>
  )
}
