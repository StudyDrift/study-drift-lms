"use client"
import { RootPage } from "@/components/root-page"
import { Button } from "@/components/ui/button"
import { useRouter } from "next/navigation"

export default function Page() {
  const router = useRouter()

  return (
    <RootPage
      title="Courses"
      actions={[
        <Button
          key="create-course"
          onClick={() => router.push("/courses/create")}
        >
          Create Course
        </Button>,
      ]}
    >
      <p>hello</p>
    </RootPage>
  )
}
