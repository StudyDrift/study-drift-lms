import { useGetMyCoursesQuery } from "@/redux/services/course.api"
import {
  Accordion,
  AccordionBody,
  ListItem,
  Typography,
} from "@material-tailwind/react"
import { ChevronDownIcon } from "lucide-react"
import Link from "next/link"

interface Props {
  isOpen: boolean
  onToggle: () => void
  listItemClassName?: string
}

export const SideNavCourses = ({
  isOpen,
  onToggle,
  listItemClassName,
}: Props) => {
  const { data: courses, isLoading: isCoursesLoading } = useGetMyCoursesQuery()

  return (
    <Accordion open={isOpen}>
      <ListItem
        selected={isOpen}
        data-selected={isOpen}
        onClick={onToggle}
        className="px-3 py-2 select-courses hover:bg-gray-100 focus:bg-gray-100 active:bg-gray-100 hover:text-gray-900 focus:text-gray-900 active:text-gray-900 data-[selected=true]:text-gray-900 select-none"
        ripple={false}
        disabled={isCoursesLoading}
      >
        <Typography className="mr-auto font-normal text-inherit">
          Courses
        </Typography>
        <ChevronDownIcon
          strokeWidth={3}
          className={`ml-auto h-4 w-4 text-gray-500 transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </ListItem>
      <AccordionBody>
        {(courses ?? []).map((item, index) => (
          <Link key={index} href={`/courses/${item.id}`}>
            <ListItem
              key={index}
              className={listItemClassName + " flex flex-col select-none"}
              ripple={false}
            >
              <Typography className="mr-auto font-normal text-inherit text-xs text-gray-500">
                {item.code}
              </Typography>
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
