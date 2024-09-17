"use client"
import { ScopedCommand } from "@/components/command-pallete/scoped-command"
import { Editor } from "@/components/editor"
import { RootPage } from "@/components/root-page"
import { PERMISSION_COURSE_CONTENT_UPDATE } from "@/models/permissions/course.permission"
import {
  useGetCourseHomeQuery,
  useUpdateCourseHomeMutation,
} from "@/redux/services/course-home.api"
import { Button } from "@material-tailwind/react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"

export default function Page() {
  const { courseId } = useParams<{ courseId: string }>()
  const { data: courseHome, isLoading: isCourseLoading } =
    useGetCourseHomeQuery(courseId)
  const router = useRouter()
  const [updateCourseHome, { isLoading: isUpdating }] =
    useUpdateCourseHomeMutation()

  const [body, setBody] = useState("")
  const isSet = useRef(false)

  useEffect(() => {
    if (!isSet.current && courseHome) {
      setBody(courseHome?.body || "")
      isSet.current = true
    }
  }, [courseHome])

  const handleSave = async () => {
    await updateCourseHome({
      courseId,
      payload: {
        body,
        meta: {},
      },
    })

    router.push(`/courses/${courseId}/home`)
  }

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
          <Button key="save" onClick={handleSave} loading={isUpdating}>
            Save
          </Button>
        </ScopedCommand>,
      ]}
    >
      <Editor
        value={body}
        onChange={(body) => setBody(body)}
        className="mt-8"
      />
    </RootPage>
  )
}
