"use client"
import { Restrict } from "@/components/permission/restrict"
import { RootPage } from "@/components/root-page"
import { PERMISSION_COURSES_CREATE } from "@/models/permissions/courses.permissions"
import { Button } from "@material-tailwind/react"
import { useRouter } from "next/navigation"

export default function Page() {
  const router = useRouter()

  return (
    <RootPage
      title="Courses"
      actions={[
        <Restrict key="create-course" permission={PERMISSION_COURSES_CREATE}>
          <Button onClick={() => router.push("/courses/create")}>
            Create Course
          </Button>
          ,
        </Restrict>,
      ]}
    >
      <p>hello</p>
    </RootPage>
  )
}
