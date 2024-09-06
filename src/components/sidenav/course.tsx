import { useCourseData } from "@/hooks/use-course-data.hooks"
import { useCheckPermission } from "@/hooks/use-restrictions.hook"
import {
  PERMISSION_COURSE_GRADEBOOK_VIEW,
  PERMISSION_COURSE_SETTINGS_VIEW,
} from "@/models/permissions/course.permission"
import {
  ChatBubbleLeftIcon,
  CogIcon,
  HomeIcon,
} from "@heroicons/react/24/outline"
import {
  Accordion,
  AccordionBody,
  ListItem,
  ListItemPrefix,
  Typography,
} from "@material-tailwind/react"
import { LetterCaseCapitalizeIcon } from "@radix-ui/react-icons"
import {
  ChevronDownIcon,
  ListCheckIcon,
  NotebookIcon,
  StampIcon,
} from "lucide-react"
import Link from "next/link"
import { useEffect, useRef } from "react"

interface Props {
  isOpen: boolean
  onToggle: () => void
  onForceOpen: () => void
  listItemClassName?: string
}

export const SideNavCourse = ({
  isOpen,
  onToggle,
  listItemClassName,
  onForceOpen,
}: Props) => {
  const { course, isLoading: isCourseLoading } = useCourseData()
  const isOpened = useRef("")
  const canSeeGradeBook = useCheckPermission(PERMISSION_COURSE_GRADEBOOK_VIEW)
  const canSeeSettings = useCheckPermission(PERMISSION_COURSE_SETTINGS_VIEW)

  const courseMenuItems = [
    {
      name: "Course Home",
      icon: <HomeIcon className="h-5 w-5" />,
      href: `/courses/${course?.id}`,
      isVisible: true,
    },
    {
      name: "Announcements",
      icon: <ChatBubbleLeftIcon className="h-5 w-5" />,
      href: `/courses/${course?.id}/announcements`,
      isVisible: true,
    },
    {
      name: "Syllabus",
      icon: <StampIcon className="h-5 w-5" />,
      href: `/courses/${course?.id}/syllabus`,
      isVisible: true,
    },
    {
      name: "Content",
      icon: <NotebookIcon className="h-5 w-5" />,
      href: `/courses/${course?.id}/content`,
      isVisible: true,
    },
    {
      name: "Assignments",
      icon: <ListCheckIcon className="h-5 w-5" />,
      href: `/courses/${course?.id}/assignments`,
      isVisible: true,
    },
    {
      name: "Gradebook",
      icon: <LetterCaseCapitalizeIcon className="h-5 w-5" />,
      href: `/courses/${course?.id}/gradebook`,
      isVisible: canSeeGradeBook,
    },
    {
      name: "Course Settings",
      icon: <CogIcon className="h-5 w-5" />,
      href: `/courses/${course?.id}/settings`,
      isVisible: canSeeSettings,
    },
  ]

  useEffect(() => {
    if (course && !isCourseLoading && isOpened.current !== course.code) {
      onForceOpen()
      isOpened.current = course.code
    }
  }, [course, isCourseLoading, onForceOpen])

  if (!course) return null

  return (
    <Accordion open={isOpen}>
      <ListItem
        selected={isOpen}
        data-selected={isOpen}
        onClick={() => onToggle()}
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
        {courseMenuItems
          .filter((x) => x.isVisible)
          .map((item, index) => (
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