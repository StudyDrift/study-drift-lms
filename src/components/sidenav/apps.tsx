import {
  Accordion,
  AccordionBody,
  ListItem,
  ListItemPrefix,
  Typography,
} from "@material-tailwind/react"
import {
  Calendar,
  ChevronDownIcon,
  LayoutDashboardIcon,
  ListCheckIcon,
  School2Icon,
} from "lucide-react"
import { useRouter } from "next/navigation"

interface Props {
  isOpen: boolean
  onToggle: () => void
  listItemClassName?: string
}

export const SideNavApps = ({ isOpen, onToggle, listItemClassName }: Props) => {
  const router = useRouter()

  const appMenuItems = [
    {
      name: "Dashboard",
      icon: <LayoutDashboardIcon className="h-5 w-5" />,
      onClick: () => router.push("/"),
    },
    {
      name: "Courses",
      icon: <School2Icon className="h-5 w-5" />,
      onClick: () => router.push("/courses"),
    },
    {
      name: "Calendar",
      icon: <Calendar className="h-5 w-5" />,
      onClick: () => router.push("/calendar"),
    },
    {
      name: "Assignments",
      icon: <ListCheckIcon className="h-5 w-5" />,
      onClick: () => router.push("/assignments"),
    },
  ]

  return (
    <Accordion open={isOpen}>
      <ListItem
        selected={isOpen}
        data-selected={isOpen}
        onClick={onToggle}
        className="px-3 py-2 select-none hover:bg-gray-100 focus:bg-gray-100 active:bg-gray-100 hover:text-gray-900 focus:text-gray-900 active:text-gray-900 data-[selected=true]:text-gray-900"
        ripple={false}
      >
        <Typography className="mr-auto font-normal text-inherit">
          Apps
        </Typography>
        <ChevronDownIcon
          strokeWidth={3}
          className={`ml-auto h-4 w-4 text-gray-500 transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </ListItem>
      <AccordionBody>
        {appMenuItems.map((item, index) => (
          <ListItem
            key={index}
            onClick={item.onClick}
            className={listItemClassName}
            ripple={false}
          >
            <ListItemPrefix>{item.icon}</ListItemPrefix>
            <Typography className="mr-auto font-normal text-inherit">
              {item.name}
            </Typography>
          </ListItem>
        ))}
      </AccordionBody>
    </Accordion>
  )
}
