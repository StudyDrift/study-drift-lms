"use client"
import { ScopedCommand } from "@/components/command-pallete/scoped-command"
import { EnrollUserDialog } from "@/components/dialogs/enroll-user.dialog"
import { Restrict } from "@/components/permission/restrict"
import { RootPage } from "@/components/root-page"
import { DataTable, DataTableSortHeader } from "@/components/tables/data-table"
import { Enrollment } from "@/models/enrollment.model"
import {
  PERMISSION_COURSE_ENROLLMENTS_CREATE,
  PERMISSION_COURSE_ENROLLMENTS_VIEW,
} from "@/models/permissions/course.permission"
import { useGetEnrollmentsByCourseIdQuery } from "@/redux/services/enrollment.api"
import { Button, Card, CardBody } from "@material-tailwind/react"
import { ColumnDef } from "@tanstack/react-table"
import { useParams } from "next/navigation"
import { useState } from "react"

const columns: ColumnDef<Enrollment>[] = [
  {
    accessorKey: "role",
    header: ({ column }) => <DataTableSortHeader column={column} name="Role" />,
  },
  {
    accessorKey: "user.first",
    header: ({ column }) => (
      <DataTableSortHeader column={column} name="First" />
    ),
  },
  {
    accessorKey: "user.last",
    header: ({ column }) => <DataTableSortHeader column={column} name="Last" />,
  },
  {
    accessorKey: "user.email",
    header: ({ column }) => (
      <DataTableSortHeader column={column} name="Email" />
    ),
  },
]

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
                setShowEnrollUserDialog(true)
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
      <Card className="mt-8">
        <CardBody>
          <DataTable columns={columns} data={enrollments || []} />
        </CardBody>
      </Card>
    </RootPage>
  )
}
