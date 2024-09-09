"use client"
import { ScopedCommand } from "@/components/command-pallete/scoped-command"
import { EnrollUserDialog } from "@/components/dialogs/enroll-user.dialog"
import { Restrict } from "@/components/permission/restrict"
import { RootPage } from "@/components/root-page"
import {
  PERMISSION_COURSE_ENROLLMENTS_CREATE,
  PERMISSION_COURSE_ENROLLMENTS_VIEW,
} from "@/models/permissions/course.permission"
import { useGetEnrollmentsByCourseIdQuery } from "@/redux/services/enrollment.api"
import { Button } from "@material-tailwind/react"
import { useParams } from "next/navigation"
import { useState } from "react"

export default function Page() {
  const { courseId } = useParams<{ courseId: string }>()
  const { data: enrollments, isLoading: isEnrollmentsLoading } =
    useGetEnrollmentsByCourseIdQuery(courseId, { skip: !courseId })

  const [showEnrollUserDialog, setShowEnrollUserDialog] = useState(false)

  return (
    <RootPage
      title="Enrollments"
      permission={PERMISSION_COURSE_ENROLLMENTS_VIEW}
      isLoading={isEnrollmentsLoading}
      actions={[
        <Restrict
          permission={PERMISSION_COURSE_ENROLLMENTS_CREATE}
          key="create"
        >
          <ScopedCommand
            command={{
              id: "enroll-user",
              name: "Enroll User",
              group: "Page Actions",
              actionType: "callback",
              action: () => {
                console.log("create enrollment")
              },
            }}
          >
            <Button
              ripple={false}
              onClick={() => setShowEnrollUserDialog(true)}
            >
              Enroll User
            </Button>
          </ScopedCommand>
        </Restrict>,
      ]}
    >
      <EnrollUserDialog
        isOpen={showEnrollUserDialog}
        onClose={() => setShowEnrollUserDialog(false)}
      />
      <p>TODO</p>
    </RootPage>
  )
}
