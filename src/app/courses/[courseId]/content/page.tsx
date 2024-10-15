"use client"
import { ScopedCommand } from "@/components/command-pallete/scoped-command"
import { ContentModuleRow } from "@/components/course-content/content-module"
import { GenerateAIModulesDialog } from "@/components/dialogs/ai-modules-generate.dialog"
import { CreateModuleDialog } from "@/components/dialogs/create-module.dialog"
import { SortableList } from "@/components/dnd/sortable-list"
import { Restrict, RestrictElse } from "@/components/permission/restrict"
import { RootPage } from "@/components/root-page"
import { useCourseData } from "@/hooks/use-course-data.hooks"
import { ContentModule } from "@/models/content.model"
import {
  PERMISSION_COURSE_AI_CREATE,
  PERMISSION_COURSE_CONTENT_CREATE,
  PERMISSION_COURSE_CONTENT_UPDATE,
} from "@/models/permissions/course.permission"
import {
  useGetCourseContentQuery,
  useSetModuleOrderMutation,
} from "@/redux/services/content.api"
import { BoltIcon } from "@heroicons/react/24/solid"
import {
  Button,
  IconButton,
  Menu,
  MenuHandler,
  MenuItem,
  MenuList,
} from "@material-tailwind/react"
import { MenuIcon, PlusIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"

export default function Page() {
  const [createModuleOpen, setCreateModuleOpen] = useState(false)
  const [modulesOpen, setModulesOpen] = useState<string[]>([])
  const [aiGenerateModulesIsOpen, setAiGenerateModulesIsOpen] = useState(false)

  const { course } = useCourseData()
  const { data: contentModulesData, isLoading: isContentLoading } =
    useGetCourseContentQuery(course?.id + "", {
      skip: !course,
    })

  const [contentModules, setContentModules] = useState<ContentModule[]>(
    contentModulesData || []
  )

  const [setOrder] = useSetModuleOrderMutation()

  const previousModules = useRef<ContentModule[]>([])

  useEffect(() => {
    if (
      !isContentLoading &&
      contentModulesData &&
      JSON.stringify(contentModulesData) !==
        JSON.stringify(previousModules.current)
    ) {
      if (modulesOpen.length === 0) {
        setModulesOpen(contentModulesData.map((m) => m.id))
      }

      setContentModules(contentModulesData)

      previousModules.current = contentModulesData
    }
  }, [contentModulesData, modulesOpen, isContentLoading])

  const handleModuleOrderChange = async (items: ContentModule[]) => {
    setContentModules(items)
    await setOrder({ courseId: course!.id, order: items.map((m) => m.id) })
  }

  const toggleCollapseAll = () => {
    if (modulesOpen.length === contentModules.length) {
      setModulesOpen([])
    } else {
      setModulesOpen(contentModules.map((m) => m.id))
    }
  }

  return (
    <RootPage
      title="Content"
      isLoading={isContentLoading}
      actions={[
        <Restrict key="ai-content" permission={PERMISSION_COURSE_AI_CREATE}>
          <ScopedCommand
            command={{
              id: "ai-content",
              name: "Create AI Content",
              group: "Page Actions",
              actionType: "callback",
              action: () => {
                setCreateModuleOpen(true)
              },
            }}
          >
            <Button
              className="flex flex-row gap-2 items-center justify-center bg-gradient-to-r from-amber-500 to-pink-500 text-black"
              onClick={() => setAiGenerateModulesIsOpen(true)}
            >
              <BoltIcon className="h-4 w-4" /> AI Generate
            </Button>
          </ScopedCommand>
        </Restrict>,
        <Restrict
          key="create-module"
          permission={PERMISSION_COURSE_CONTENT_CREATE}
        >
          <ScopedCommand
            command={{
              id: "create-module",
              name: "Create Module",
              group: "Page Actions",
              actionType: "callback",
              action: () => {
                setCreateModuleOpen(true)
              },
            }}
          >
            <Button
              className="flex flex-row gap-2 items-center justify-center"
              onClick={() => setCreateModuleOpen(true)}
            >
              <PlusIcon className="h-4 w-4" /> Module
            </Button>
          </ScopedCommand>
        </Restrict>,
        <Restrict
          key="more-options"
          permission={PERMISSION_COURSE_CONTENT_UPDATE}
        >
          <ScopedCommand
            command={{
              id: "toggle-collapse-all",
              name:
                modulesOpen.length === contentModules.length
                  ? "Collapse All"
                  : "Expand All",
              group: "Page Actions",
              actionType: "callback",
              action: () => {
                toggleCollapseAll()
              },
            }}
          >
            <Menu placement="bottom-end">
              <MenuHandler>
                <IconButton variant="text" ripple={false}>
                  <MenuIcon className="h-4 w-4" />
                </IconButton>
              </MenuHandler>
              <MenuList>
                <MenuItem onClick={toggleCollapseAll}>
                  {modulesOpen.length === contentModules.length
                    ? "Collapse All"
                    : "Expand All"}
                </MenuItem>
              </MenuList>
            </Menu>
          </ScopedCommand>
        </Restrict>,
      ]}
    >
      <CreateModuleDialog
        isOpen={createModuleOpen}
        onClose={() => setCreateModuleOpen(false)}
      />

      <GenerateAIModulesDialog
        isOpen={aiGenerateModulesIsOpen}
        onClose={() => setAiGenerateModulesIsOpen(false)}
      />

      <div className="flex flex-col gap-4 mt-6">
        <Restrict permission={PERMISSION_COURSE_CONTENT_UPDATE}>
          <SortableList
            id={"main"}
            items={contentModules || []}
            onChange={handleModuleOrderChange}
            renderItem={(item) => (
              <SortableList.Item id={item.id} key={item.id}>
                <ContentModuleRow
                  item={item}
                  isOpen={modulesOpen.includes(item.id)}
                  onToggle={() => {
                    if (modulesOpen.includes(item.id)) {
                      setModulesOpen(modulesOpen.filter((id) => id !== item.id))
                    } else {
                      setModulesOpen([...modulesOpen, item.id])
                    }
                  }}
                  dragHandle={<SortableList.DragHandle />}
                />
              </SortableList.Item>
            )}
          />
        </Restrict>
        <RestrictElse permission={PERMISSION_COURSE_CONTENT_UPDATE}>
          {contentModules.map((item) => (
            <ContentModuleRow
              key={item.id}
              item={item}
              isOpen={modulesOpen.includes(item.id)}
              onToggle={() => {
                if (modulesOpen.includes(item.id)) {
                  setModulesOpen(modulesOpen.filter((id) => id !== item.id))
                } else {
                  setModulesOpen([...modulesOpen, item.id])
                }
              }}
            />
          ))}
        </RestrictElse>
      </div>
    </RootPage>
  )
}
