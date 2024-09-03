import { RootPage } from "@/components/root-page"
import { PERMISSION_COURSE_GRADEBOOK_VIEW } from "@/models/permissions/course.permission"

export default function Page() {
  return (
    <RootPage title="Gradebook" permission={PERMISSION_COURSE_GRADEBOOK_VIEW}>
      <p>TODO</p>
    </RootPage>
  )
}
