"use client"
import { CreateModuleDialog } from "@/components/dialogs/create-module.dialog"
import { Restrict } from "@/components/permission/restrict"
import { RootPage } from "@/components/root-page"
import { Skeleton } from "@/components/ui/skeleton"
import { useCourseData } from "@/hooks/use-course-data.hooks"
import { PERMISSION_COURSE_CONTENT_CREATE } from "@/models/permissions/course.permission"
import { useGetCourseContentQuery } from "@/redux/services/content.api"
import {
  Accordion,
  AccordionBody,
  Button,
  Card,
  List,
  ListItem,
  Typography,
} from "@material-tailwind/react"
import { ChevronDownIcon, PlusIcon } from "lucide-react"
import { useEffect, useState } from "react"

export default function Page() {
  const [createModuleOpen, setCreateModuleOpen] = useState(false)
  const { course } = useCourseData()
  const { data: contentModules, isLoading: isContentLoading } =
    useGetCourseContentQuery(course?.id + "", {
      skip: !course,
    })

  const [modulesOpen, setModulesOpen] = useState<string[]>([])

  useEffect(() => {
    if (contentModules) {
      setModulesOpen(contentModules.map((m) => m.id))
    }
  }, [contentModules])

  return (
    <RootPage
      title="Content"
      actions={[
        <Restrict
          key="create-module"
          permission={PERMISSION_COURSE_CONTENT_CREATE}
        >
          <Button
            className="flex flex-row gap-2 items-center justify-center"
            onClick={() => setCreateModuleOpen(true)}
          >
            <PlusIcon className="h-4 w-4" /> Module
          </Button>
        </Restrict>,
      ]}
    >
      <CreateModuleDialog
        isOpen={createModuleOpen}
        onClose={() => setCreateModuleOpen(false)}
      />

      {isContentLoading && <Skeleton className="h-8 w-full" />}
      <div className="flex flex-col gap-4 mt-6">
        {contentModules?.map((item) => (
          <Accordion key={item.id} open={modulesOpen.includes(item.id)}>
            <ListItem
              selected={modulesOpen.includes(item.id)}
              data-selected={modulesOpen.includes(item.id)}
              onClick={() => {
                if (modulesOpen.includes(item.id)) {
                  setModulesOpen(modulesOpen.filter((id) => id !== item.id))
                } else {
                  setModulesOpen([...modulesOpen, item.id])
                }
              }}
              className={
                "px-3 py-2 select-courses hover:bg-gray-100 focus:bg-gray-100 active:bg-gray-100 hover:text-gray-900 focus:text-gray-900 active:text-gray-900 data-[selected=true]:text-gray-900 bg-white rounded-lg shadow-md " +
                (modulesOpen.includes(item.id) ? "rounded-b-none" : "")
              }
              ripple={false}
            >
              <Typography className="mr-auto font-normal text-inherit">
                {item.name}
              </Typography>
              <ChevronDownIcon
                strokeWidth={3}
                className={`ml-auto h-4 w-4 text-gray-500 transition-transform ${
                  modulesOpen.includes(item.id) ? "rotate-180" : ""
                }`}
              />
            </ListItem>
            <AccordionBody className="p-0 rounded-t-none mb-1">
              <Card className="p-1 rounded-t-none">
                <List>
                  <ListItem onClick={() => null}>{item.name}</ListItem>
                </List>
              </Card>
            </AccordionBody>
          </Accordion>
        ))}
      </div>

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
