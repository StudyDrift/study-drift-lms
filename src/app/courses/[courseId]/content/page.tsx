"use client"
import { Restrict } from "@/components/permission/restrict"
import { RootPage } from "@/components/root-page"
import { PERMISSION_COURSE_CONTENT_CREATE } from "@/models/permissions/course.permission"
import { Button } from "@material-tailwind/react"
import { PlusIcon } from "lucide-react"

export default function Page() {
  return (
    <RootPage
      title="Content"
      actions={[
        <Restrict
          key="create-module"
          permission={PERMISSION_COURSE_CONTENT_CREATE}
        >
          <Button className="flex flex-row gap-2 items-center justify-center">
            <PlusIcon className="h-4 w-4" /> Module
          </Button>
        </Restrict>,
      ]}
    >
      {/* <SortableList
            id={"main"}
            items={items}
            onChange={handleModuleOrderChange}
            renderItem={(item) => (
              <SortableList.Item id={item.id} key={item.id}>
                <ContentModuleRow
                  item={item}
                  dragHandle={<SortableList.DragHandle />}
                />
              </SortableList.Item>
            )}
          /> */}
    </RootPage>
  )
}
