"use client"
import { ScopedCommand } from "@/components/command-pallete/scoped-command"
import { Restrict } from "@/components/permission/restrict"
import { RootPage } from "@/components/root-page"
import { useCourseData } from "@/hooks/use-course-data.hooks"
import { PERMISSION_COURSE_CONTENT_UPDATE } from "@/models/permissions/course.permission"
import { Button } from "@material-tailwind/react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"

export default function Page() {
  const { course, isLoading: isCourseLoading } = useCourseData()
  const { courseId } = useParams<{ courseId: string }>()
  const router = useRouter()

  return (
    <RootPage
      title="Course"
      isLoading={isCourseLoading}
      actions={[
        <Restrict permission={PERMISSION_COURSE_CONTENT_UPDATE} key="edit">
          <ScopedCommand
            command={{
              id: "edit-home",
              name: "Edit Home",
              group: "Course Actions",
              actionType: "callback",
              action: () => {
                router.push(`/courses/${courseId}/home/edit`)
              },
            }}
          >
            <Link href={`/courses/${courseId}/home/edit`}>
              <Button>Edit</Button>
            </Link>
          </ScopedCommand>
        </Restrict>,
      ]}
    >
      Welcome to the course
    </RootPage>
  )
}
