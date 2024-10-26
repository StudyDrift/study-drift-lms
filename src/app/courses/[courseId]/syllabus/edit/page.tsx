"use client"
import { ScopedCommand } from "@/components/command-pallete/scoped-command"
import { GenerateAIContentDialog } from "@/components/dialogs/ai-content-generate.dialog"
import { Editor } from "@/components/editor"
import { Restrict } from "@/components/permission/restrict"
import { RootPage } from "@/components/root-page"
import { PERMISSION_COURSE_AI_CREATE } from "@/models/permissions/course.permission"
import { useGetCourseByIdQuery } from "@/redux/services/course.api"
import {
  useGetSyllabusByCourseIdQuery,
  useUpdateSyllabusMutation,
} from "@/redux/services/syllabus.api"
import { BoltIcon } from "@heroicons/react/24/solid"
import { Button } from "@material-tailwind/react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"

export default function Page() {
  const { courseId } = useParams<{ courseId: string }>()
  const router = useRouter()
  const [showAIPrompt, setShowAIPrompt] = useState(false)
  const { data: syllabus, isLoading: isSyllabusLoading } =
    useGetSyllabusByCourseIdQuery(courseId, {
      skip: !courseId,
    })

  const [updateSyllabus, { isLoading: isSyllabusUpdating }] =
    useUpdateSyllabusMutation()

  const { data: course, isLoading: isCourseLoading } = useGetCourseByIdQuery(
    courseId,
    {
      skip: !courseId,
    }
  )

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
        <Restrict key="ai-content" permission={PERMISSION_COURSE_AI_CREATE}>
          <ScopedCommand
            command={{
              id: "generate-ai-content",
              name: "Generate AI Content",
              group: "Page Actions",
              actionType: "callback",
              action: () => {
                setShowAIPrompt(!showAIPrompt)
              },
            }}
          >
            <div>
              <Button
                className="flex flex-row gap-2 items-center justify-center bg-gradient-to-r from-amber-500 to-pink-500 text-black"
                onClick={() => setShowAIPrompt(!showAIPrompt)}
                loading={isCourseLoading}
              >
                <BoltIcon className="h-4 w-4" /> Generate
              </Button>
            </div>
          </ScopedCommand>
        </Restrict>,
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
      <GenerateAIContentDialog
        isOpen={showAIPrompt}
        onClose={(res) => {
          setShowAIPrompt(false)
          if (res) {
            setBody(res.content)
          }
        }}
        activityName={`
a course with the following details:
 - course name: ${course?.name} 
 - course description: ${course?.description}
 - course code: ${course?.code}. 
 
 Generate a syllabus for this course.
          `.trim()}
      />
      <Editor
        className="min-h-screen mt-8"
        value={body}
        onChange={(body) => setBody(body)}
      />
    </RootPage>
  )
}
