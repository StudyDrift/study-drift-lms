"use client"
import { ScopedCommand } from "@/components/command-pallete/scoped-command"
import InitializedMDXEditor from "@/components/editor/InitializedMDXEditor"
import { RootPage } from "@/components/root-page"
import {
  useGetSyllabusByCourseIdQuery,
  useUpdateSyllabusMutation,
} from "@/redux/services/syllabus.api"
import { Button, Card } from "@material-tailwind/react"
import { MDXEditorMethods } from "@mdxeditor/editor"
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

  const editor = useRef<MDXEditorMethods>(null)

  useEffect(() => {
    editor.current?.setMarkdown(syllabus?.body || "")
  }, [syllabus])

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
            <Button variant="outlined">Preview</Button>
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
          >
            Publish
          </Button>
        </ScopedCommand>,
      ]}
    >
      <Card className="min-h-screen mt-8">
        <InitializedMDXEditor
          editorRef={editor}
          markdown={syllabus?.body || ""}
          onChange={(body) => setBody(body)}
          contentEditableClassName="prose"
          placeholder="Start typing here..."
          className="min-h-screen"
        />
      </Card>
    </RootPage>
  )
}
