import { Command, CommandContextOption } from "@/models/command.model"
import { ContentItem, ContentType } from "@/models/content.model"
import {
  PERMISSION_COURSE_GRADEBOOK_VIEW,
  PERMISSION_COURSE_SETTINGS_VIEW,
} from "@/models/permissions/course.permission"
import { getContentItemsByCourseId } from "../content-item.service"
import { getAllContentTypes } from "../content-type.service"
import { getCourseByIds } from "../course.service"
import { getByUserId } from "../enrollment.service"

/**
 * const courseMenuItems = [
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
 */

export const getCoursesCommands = async (
  userId: string,
  options: CommandContextOption
) => {
  const enrollments = await getByUserId(userId)
  const courses = await getCourseByIds(enrollments.map((e) => e.courseId))

  const courseId = options.courseId

  const commands: Command[] = courses.map((course) => ({
    id: course.id,
    name: `${course.code} - ${course.name}`,
    group: "Courses",
    actionType: "link",
    action: `/courses/${course.id}`,
    icon: "DocumentIcon",
  }))

  if (courseId) {
    const contentItems = (await getContentItemsByCourseId(
      courseId
    )) as ContentItem[]
    const contentTypes = (await getAllContentTypes()) as ContentType[]

    commands.push(
      ...contentItems.map((item) => ({
        id: item.id,
        name: item.name,
        group: "Course Content",
        actionType: "link",
        action: `/courses/${courseId}/content/${item.id}`,
        icon:
          contentTypes.find((x) => x.id === item.contentTypeId)?.icon ||
          "DocumentIcon",
      }))
    )

    commands.push(
      ...[
        {
          id: courseId + "-course-home",
          name: "Course Home",
          group: "Course",
          actionType: "link",
          action: `/courses/${courseId}`,
          icon: "HomeIcon",
        },
        {
          id: courseId + "-announcements",
          name: "Announcements",
          group: "Course",
          actionType: "link",
          action: `/courses/${courseId}/announcements`,
          icon: "ChatBubbleLeftIcon",
        },
        {
          id: courseId + "-syllabus",
          name: "Syllabus",
          group: "Course",
          actionType: "link",
          action: `/courses/${courseId}/syllabus`,
          icon: "StampIcon",
        },
        {
          id: courseId + "-content",
          name: "Content",
          group: "Course",
          actionType: "link",
          action: `/courses/${courseId}/content`,
          icon: "NotebookIcon",
        },
        {
          id: courseId + "-assignments",
          name: "Assignments",
          group: "Course",
          actionType: "link",
          action: `/courses/${courseId}/assignments`,
          icon: "ListCheckIcon",
        },
        {
          id: courseId + "-gradebook",
          name: "Gradebook",
          group: "Course",
          actionType: "link",
          action: `/courses/${courseId}/gradebook`,
          icon: "LetterCaseCapitalizeIcon",
          permission: PERMISSION_COURSE_GRADEBOOK_VIEW,
        },
        {
          id: courseId + "-course-settings",
          name: "Course Settings",
          group: "Course",
          actionType: "link",
          action: `/courses/${courseId}/settings`,
          icon: "CogIcon",
          permission: PERMISSION_COURSE_SETTINGS_VIEW,
        },
      ]
    )
  }

  return commands
}
