"use client"
import { ScopedCommand } from "@/components/command-pallete/scoped-command"
import { CourseCard } from "@/components/course-card"
import { SortableList } from "@/components/dnd/sortable-list"
import { Restrict } from "@/components/permission/restrict"
import { RootPage } from "@/components/root-page"
import { Skeleton } from "@/components/ui/skeleton"
import { Course } from "@/models/course.model"
import { PERMISSION_COURSES_CREATE } from "@/models/permissions/courses.permissions"
import {
  useGetUserAppSettingsQuery,
  useUpdateUserAppSettingsMutation,
} from "@/redux/services/app.api"
import { useGetMyCoursesQuery } from "@/redux/services/course.api"
import { Button } from "@material-tailwind/react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"

export default function Page() {
  const router = useRouter()
  const [courses, setCourses] = useState<Course[]>([])
  const { data: courseData, isLoading: isCoursesLoading } =
    useGetMyCoursesQuery()
  const [updateCoursesSettings] = useUpdateUserAppSettingsMutation()
  const { data: appSettings, isLoading: isAppSettingsLoading } =
    useGetUserAppSettingsQuery("courses")

  const isSet = useRef(false)

  useEffect(() => {
    if (
      courseData &&
      !isCoursesLoading &&
      !isAppSettingsLoading &&
      !isSet.current
    ) {
      const newCourseData = [...courseData]

      setCourses(
        newCourseData.sort(
          (a, b) =>
            (appSettings?.settings?.order || []).indexOf(a.id) -
            (appSettings?.settings?.order || []).indexOf(b.id)
        )
      )
      isSet.current = true
    }
  }, [courseData, isCoursesLoading, isAppSettingsLoading, appSettings])

  const handleOrderChange = (items: Course[]) => {
    setCourses(items)
    updateCoursesSettings({
      app: "courses",
      settings: { order: items.map((item) => item.id) },
    })
  }

  return (
    <RootPage
      title="Courses"
      actions={[
        <Restrict key="create-course" permission={PERMISSION_COURSES_CREATE}>
          <ScopedCommand
            command={{
              id: "create-course",
              name: "Create Course",
              actionType: "link",
              action: "/courses/create",
              group: "Page Actions",
            }}
          >
            <Link href={"/courses/create"}>
              <Button>Create Course</Button>
            </Link>
          </ScopedCommand>
        </Restrict>,
      ]}
    >
      {(isCoursesLoading || isAppSettingsLoading) && (
        <Skeleton className="w-full h-10 mt-8" />
      )}
      <div className="flex flex-row gap-4 flex-wrap mt-8">
        {isSet.current &&
          courses.length > 0 &&
          !isCoursesLoading &&
          !isAppSettingsLoading && (
            <SortableList
              id={"courses-home"}
              items={courses}
              renderItem={(item) => (
                <SortableList.Item key={item.id} id={item.id}>
                  <CourseCard
                    course={item}
                    dragHandle={<SortableList.DragHandle />}
                  />
                </SortableList.Item>
              )}
              onChange={handleOrderChange}
            />
          )}
      </div>
    </RootPage>
  )
}
