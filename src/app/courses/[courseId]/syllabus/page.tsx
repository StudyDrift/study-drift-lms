"use client"
import { ScopedCommand } from "@/components/command-pallete/scoped-command"
import { RootPage } from "@/components/root-page"
import { useGetSyllabusByCourseIdQuery } from "@/redux/services/syllabus.api"
import { Button, Card, CardBody } from "@material-tailwind/react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import Markdown from "react-markdown"
import rehypeRaw from "rehype-raw"
import remarkGfm from "remark-gfm"

export default function Page() {
  const router = useRouter()
  const { courseId } = useParams<{ courseId: string }>()
  const { data: syllabus, isLoading: isSyllabusLoading } =
    useGetSyllabusByCourseIdQuery(courseId, {
      skip: !courseId,
    })

  return (
    <RootPage
      title="Syllabus"
      isLoading={isSyllabusLoading}
      actions={[
        <ScopedCommand
          key="edit"
          command={{
            id: "edit-syllabus",
            name: "Edit Syllabus",
            group: "Page Actions",
            actionType: "callback",
            action: () => {
              router.push(`/courses/${courseId}/syllabus/edit`)
            },
          }}
        >
          <Link href={`/courses/${courseId}/syllabus/edit`}>
            <Button ripple={false}>Edit</Button>
          </Link>
        </ScopedCommand>,
      ]}
    >
      <Card className="mt-8">
        <CardBody>
          <Markdown
            className="prose"
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeRaw]}
          >
            {syllabus?.body || "No Syllabus"}
          </Markdown>
        </CardBody>
      </Card>
    </RootPage>
  )
}
