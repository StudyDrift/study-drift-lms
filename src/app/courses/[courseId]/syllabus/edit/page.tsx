"use client"
import { ScopedCommand } from "@/components/command-pallete/scoped-command"
import { Editor } from "@/components/editor"
import { RootPage } from "@/components/root-page"
import {
  useGetSyllabusByCourseIdQuery,
  useUpdateSyllabusMutation,
} from "@/redux/services/syllabus.api"
import { Button } from "@material-tailwind/react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"

export default function Page() {
  const { courseId } = useParams<{ courseId: string }>()
  const router = useRouter()
  const { data: syllabus, isLoading: isSyllabusLoading } =
    useGetSyllabusByCourseIdQuery(courseId, {
      skip: !courseId,
    })

  const [updateSyllabus, { isLoading: isSyllabusUpdating }] =
    useUpdateSyllabusMutation()

  const [body, setBody] = useState<string>(syllabus?.body || "")

  const isSet = useRef(false)

  useEffect(() => {
    if (!isSet.current) {
      isSet.current = true
      setBody(syllabus?.body || "")
      return
    }
  }, [syllabus])

  const handlePublish = async () => {
    await updateSyllabus({
      courseId,
      body,
    })
  }

  return (
    <RootPage
      title="Edit Syllabus"
      isLoading={isSyllabusLoading}
      actions={[
        <ScopedCommand
          key="preview"
          command={{
            id: "preview-syllabus",
            name: "Preview Syllabus",
            group: "Page Actions",
            actionType: "callback",
            action: () => {
              router.push(`/courses/${courseId}/syllabus`)
            },
          }}
        >
          <Link href={`/courses/${courseId}/syllabus`}>
            <Button ripple={false} variant="outlined">
              Preview
            </Button>
          </Link>
        </ScopedCommand>,
        <ScopedCommand
          key="publish"
          command={{
            id: "publish-syllabus",
            name: "Publish Syllabus",
            group: "Page Actions",
            actionType: "callback",
            action: () => {
              handlePublish()
            },
          }}
        >
          <Button
            color="blue"
            onClick={handlePublish}
            loading={isSyllabusUpdating}
            ripple={false}
          >
            Publish
          </Button>
        </ScopedCommand>,
      ]}
    >
      <Editor
        className="min-h-screen mt-8"
        value={body}
        onChange={(body) => setBody(body)}
      />
    </RootPage>
  )
}
