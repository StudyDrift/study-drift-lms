import { ContentItem, ContentModule } from "@/models/content.model"
import { PERMISSION_COURSE_CONTENT_UPDATE } from "@/models/permissions/course.permission"
import { useGetAllContentTypesQuery } from "@/redux/services/content-type.api"
import { useSetContentItemsOrderMutation } from "@/redux/services/content.api"
import {
  Accordion,
  AccordionBody,
  Card,
  List,
  ListItem,
  ListItemPrefix,
  ListItemSuffix,
  Typography,
} from "@material-tailwind/react"
import { ChevronDownIcon } from "lucide-react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useEffect, useState } from "react"
import { SortableList } from "../dnd/sortable-list"
import { getIcon } from "../icons"
import { Restrict, RestrictElse } from "../permission/restrict"
import { AddNewContent } from "./add-new-content"
import { ContentItemActions } from "./content-item-actions"
import { ContentModuleActions } from "./content-module-actions"
import { PublishContentItem } from "./publish-content-item"

interface Props {
  item: ContentModule
  isOpen: boolean
  onToggle: () => void
  dragHandle?: React.ReactNode
}

export const ContentModuleRow = ({
  item,
  isOpen,
  onToggle,
  dragHandle,
}: Props) => {
  const [children, setChildren] = useState<ContentItem[]>(item.children || [])
  const [updateOrder] = useSetContentItemsOrderMutation()
  const { courseId } = useParams<{ courseId: string }>()

  const { data: contentTypes } = useGetAllContentTypesQuery(courseId)

  useEffect(() => {
    if (item.children?.length !== children?.length) {
      setChildren(item.children || [])
    }

    // Check if the icons are different
    const newChildren = [...children]
    for (const child of newChildren) {
      if (
        child.contentTypeId !==
          item.children?.find((c) => c.id === child.id)?.contentTypeId ||
        child.name !== item.children?.find((c) => c.id === child.id)?.name
      ) {
        setChildren(item.children || [])
        break
      }
    }
  }, [item.children, children])

  const handleItemOrderChange = async (items: ContentItem[]) => {
    setChildren(items)
    await updateOrder({
      courseId: item.courseId,
      contentItemIds: items.map((i) => i.id),
    })
  }

  const getContentTypeIcon = (contentTypeId: string) => {
    const contentType = contentTypes?.find((c) => c.id === contentTypeId)
    const Icon = getIcon(contentType?.icon)
    return <Icon className="h-4 w-4" />
  }

  const isHeading = (item: ContentItem) => {
    return item.contentTypeId === "heading"
  }

  return (
    <Accordion open={isOpen}>
      <ListItem
        selected={isOpen}
        data-selected={isOpen}
        onClick={onToggle}
        className={
          "px-3 py-2 select-courses hover:bg-gray-100 focus:bg-gray-100 active:bg-gray-100 hover:text-gray-900 focus:text-gray-900 active:text-gray-900 data-[selected=true]:text-gray-900 bg-white rounded-lg shadow-md " +
          (isOpen ? "rounded-b-none" : "")
        }
        ripple={false}
      >
        <Typography className="mr-auto font-normal text-inherit flex flex-row items-center gap-3">
          {dragHandle} {item.name}
        </Typography>
        <div className="flex flex-row items-center gap-3">
          <ContentModuleActions item={item} />
          <ChevronDownIcon
            strokeWidth={3}
            className={`ml-auto h-4 w-4 text-gray-500 transition-transform ${
              isOpen ? "rotate-180" : ""
            }`}
          />
        </div>
      </ListItem>
      <AccordionBody className="p-0 rounded-t-none mb-1">
        <Card className="p-1 rounded-t-none">
          <Restrict permission={PERMISSION_COURSE_CONTENT_UPDATE}>
            <SortableList
              id={"child-" + item.id}
              items={children}
              onChange={handleItemOrderChange}
              renderItem={(child) => (
                <SortableList.Item id={child.id} key={child.id}>
                  <ListItem
                    className={
                      "py-1 my-1 hover:underline " +
                      (isHeading(child)
                        ? "-ml-1 hover:no-underline hover:bg-transparent active:bg-transparent focus:bg-transparent"
                        : "")
                    }
                    ripple={false}
                  >
                    <ListItemPrefix
                      className={"ml-4 " + (isHeading(child) ? "ml-0" : "")}
                    >
                      <SortableList.DragHandle />
                    </ListItemPrefix>

                    {isHeading(child) ? (
                      <Typography variant="h4">{child.name}</Typography>
                    ) : (
                      <Link
                        href={`/courses/${item.courseId}/content/${child.id}`}
                        className="flex flex-row items-center gap-3"
                      >
                        <ListItemPrefix className="mr-1">
                          {getContentTypeIcon(child.contentTypeId)}
                        </ListItemPrefix>
                        {child.name}
                      </Link>
                    )}

                    <ListItemSuffix
                      className={
                        "flex flex-row" + (isHeading(child) ? " -mr-1" : "")
                      }
                    >
                      <PublishContentItem
                        contentItemId={child.id}
                        courseId={item.courseId}
                        isPublished={child.settings.isPublished || false}
                      />
                      <ContentItemActions item={child} />
                    </ListItemSuffix>
                  </ListItem>
                </SortableList.Item>
              )}
            />
            <AddNewContent moduleId={item.id} itemCount={children.length} />
          </Restrict>

          <RestrictElse permission={PERMISSION_COURSE_CONTENT_UPDATE}>
            <List>
              {item.children?.map((child) => (
                <ListItem
                  onClick={() => null}
                  key={child.id}
                  className="py-1"
                  ripple={false}
                >
                  {child.name}
                </ListItem>
              ))}
            </List>
          </RestrictElse>
        </Card>
      </AccordionBody>
    </Accordion>
  )
}
