import { useCourseData } from "@/hooks/use-course-data.hooks"
import {
  Accordion,
  AccordionBody,
  ListItem,
  ListItemPrefix,
  Typography,
} from "@material-tailwind/react"
import {
  ChevronDownIcon,
  ListCheckIcon,
  NotebookIcon,
  StampIcon,
} from "lucide-react"

interface Props {
  isOpen: boolean
  onToggle: () => void
  listItemClassName?: string
}

export const SideNavCourse = ({
  isOpen,
  onToggle,
  listItemClassName,
}: Props) => {
  const { course, isLoading: isCourseLoading } = useCourseData()

  const courseMenuItems = [
    {
      name: "Syllabus",
      icon: <StampIcon className="h-5 w-5" />,
      onClick: () => {},
    },
    {
      name: "Content",
      icon: <NotebookIcon className="h-5 w-5" />,
      onClick: () => {},
    },
    {
      name: "Assignments",
      icon: <ListCheckIcon className="h-5 w-5" />,
      onClick: () => {},
    },
  ]

  if (!course) return null

  return (
    <Accordion open={isOpen}>
      <ListItem
        selected={isOpen}
        data-selected={isOpen}
        onClick={onToggle}
        className="px-3 py-2 select-courses hover:bg-gray-100 focus:bg-gray-100 active:bg-gray-100 hover:text-gray-900 focus:text-gray-900 active:text-gray-900 data-[selected=true]:text-gray-900"
        ripple={false}
        disabled={isCourseLoading}
      >
        <Typography className="mr-auto font-normal text-inherit">
          {course.code}
        </Typography>
        <ChevronDownIcon
          strokeWidth={3}
          className={`ml-auto h-4 w-4 text-gray-500 transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </ListItem>
      <AccordionBody>
        {courseMenuItems.map((item, index) => (
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
