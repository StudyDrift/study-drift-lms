import { useCheckPermission } from "@/hooks/use-restrictions.hook"
import { PERMISSION_APPS_SETTINGS_VIEW } from "@/models/permissions/app.permission"
import { LockClosedIcon } from "@heroicons/react/24/outline"
import {
  Accordion,
  AccordionBody,
  ListItem,
  ListItemPrefix,
  Typography,
} from "@material-tailwind/react"
import { GearIcon } from "@radix-ui/react-icons"
import {
  Calendar,
  ChevronDownIcon,
  LayoutDashboardIcon,
  School2Icon
} from "lucide-react"
import Link from "next/link"
import { useState } from "react"

interface Props {
  isOpen: boolean
  onToggle: () => void
  listItemClassName?: string
}

export const SideNavApps = ({ isOpen, onToggle, listItemClassName }: Props) => {
  const canSeeSettings = useCheckPermission(PERMISSION_APPS_SETTINGS_VIEW)
  const [open, setOpen] = useState("")

  const appMenuItems = [
    {
      name: "Dashboard",
      icon: <LayoutDashboardIcon className="h-5 w-5" />,
      href: "/",
      isVisible: true,
    },
    {
      name: "Courses",
      icon: <School2Icon className="h-5 w-5" />,
      href: "/courses",
      isVisible: true,
    },
    {
      name: "Calendar",
      icon: <Calendar className="h-5 w-5" />,
      href: "/calendar",
      isVisible: true,
    },
    {
      name: "System Settings",
      icon: <GearIcon className="h-5 w-5" />,
      isVisible: canSeeSettings,
      children: [
        {
          name: "Roles & Permissions",
          icon: <LockClosedIcon className="h-5 w-5" />,
          href: "/system/roles-and-permissions",
        },
      ],
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
        {appMenuItems
          .filter((x) => x.isVisible)
          .map((item, index) =>
            item.href ? (
              <Link key={item.name + index} href={item.href}>
                <ListItem className={listItemClassName} ripple={false}>
                  <ListItemPrefix>{item.icon}</ListItemPrefix>
                  <Typography className="mr-auto font-normal text-inherit">
                    {item.name}
                  </Typography>
                </ListItem>
              </Link>
            ) : (
              <Accordion open={open === item.name} key={item.name + index}>
                <ListItem
                  selected={open === item.name}
                  data-selected={open === item.name}
                  onClick={() => setOpen(open === item.name ? "" : item.name)}
                  ripple={false}
                  className={listItemClassName}
                >
                  <ListItemPrefix>{item.icon}</ListItemPrefix>
                  <Typography className="mr-auto font-normal text-inherit">
                    {item.name}
                  </Typography>
                  <ChevronDownIcon
                    strokeWidth={3}
                    className={`ml-auto h-4 w-4 text-gray-500 transition-transform ${
                      open === item.name ? "rotate-180" : ""
                    }`}
                  />
                </ListItem>
                <AccordionBody>
                  {item.children?.map((child, idx) => (
                    <Link key={child.name + idx} href={child.href}>
                      <ListItem className={listItemClassName} ripple={false}>
                        <ListItemPrefix>{child.icon}</ListItemPrefix>
                        <Typography className="mr-auto font-normal text-inherit">
                          {child.name}
                        </Typography>
                      </ListItem>
                    </Link>
                  ))}
                </AccordionBody>
              </Accordion>
            )
          )}
      </AccordionBody>
    </Accordion>
  )
}
