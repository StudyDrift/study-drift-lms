"use client"
import { ScopedCommand } from "@/components/command-pallete/scoped-command"
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

  const handleSave = () => {}

  return (
    <RootPage
      title="Course"
      isLoading={isCourseLoading}
      permission={PERMISSION_COURSE_CONTENT_UPDATE}
      actions={[
        <ScopedCommand
          key="preview"
          command={{
            id: "preview",
            name: "Preview",
            group: "Course Actions",
            actionType: "callback",
            action: () => {
              router.push(`/courses/${courseId}/home`)
            },
          }}
        >
          <Link href={`/courses/${courseId}/home`}>
            <Button variant="outlined">Preview</Button>
          </Link>
        </ScopedCommand>,
        <ScopedCommand
          key="save"
          command={{
            id: "save",
            name: "Save",
            group: "Course Actions",
            actionType: "callback",
            action: () => {
              handleSave()
            },
          }}
        >
          <Button key="save" onClick={handleSave}>
            Save
          </Button>
        </ScopedCommand>,
      ]}
    >
      Welcome to the course
    </RootPage>
  )
}
