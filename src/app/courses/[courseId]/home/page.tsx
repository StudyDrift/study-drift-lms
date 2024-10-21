"use client"
import { ScopedCommand } from "@/components/command-pallete/scoped-command"
import { Restrict } from "@/components/permission/restrict"
import { RootPage } from "@/components/root-page"
import {
  PERMISSION_COURSE_CONTENT_UPDATE,
  PERMISSION_COURSE_IMPERSONATE_VIEW,
} from "@/models/permissions/course.permission"
import { useGetCourseHomeQuery } from "@/redux/services/course-home.api"
import { Button, Card, CardBody } from "@material-tailwind/react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import Markdown from "react-markdown"
import rehypeRaw from "rehype-raw"
import remarkGfm from "remark-gfm"

export default function Page() {
  const { courseId } = useParams<{ courseId: string }>()
  const { data: courseHome, isLoading: isCourseHomeLoading } =
    useGetCourseHomeQuery(courseId)
  const router = useRouter()

  return (
    <RootPage
      title="Course"
      isLoading={isCourseHomeLoading}
      actions={[
        <Restrict
          permission={PERMISSION_COURSE_IMPERSONATE_VIEW}
          key="impersonate"
        >
          <ScopedCommand
            command={{
              id: "impersonate",
              name: "Impersonate",
              group: "Course Actions",
              actionType: "callback",
              action: () => {
                window.location.href = `/api/auth/assume?callback=/courses/${courseId}/home&role=student`
              },
            }}
          >
            <a
              href={`/api/auth/assume?callback=/courses/${courseId}/home&role=student`}
            >
              <Button variant="outlined">View as Student</Button>
            </a>
          </ScopedCommand>
        </Restrict>,
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
      <Card className="mt-8">
        <CardBody>
          <Markdown
            className="prose"
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeRaw]}
          >
            {courseHome?.body}
          </Markdown>
        </CardBody>
      </Card>
    </RootPage>
  )
}
