"use client"
import { ScopedCommand } from "@/components/command-pallete/scoped-command"
import { CreateAnnouncementDialog } from "@/components/dialogs/create-announcement.dialog"
import { Restrict } from "@/components/permission/restrict"
import { RootPage } from "@/components/root-page"
import { PERMISSION_COURSE_ANNOUNCEMENTS_CREATE } from "@/models/permissions/course.permission"
import { useGetCourseAnnouncementsQuery } from "@/redux/services/announcement.api"
import {
  Accordion,
  AccordionBody,
  AccordionHeader,
  Button,
  Card,
  Typography,
} from "@material-tailwind/react"
import { useParams } from "next/navigation"
import { useState } from "react"
import Markdown from "react-markdown"
import rehypeRaw from "rehype-raw"
import remarkGfm from "remark-gfm"

export default function Page() {
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const { courseId } = useParams<{ courseId: string }>()
  const { data: announcements, isLoading: isAnnouncementsLoading } =
    useGetCourseAnnouncementsQuery(courseId, {
      skip: !courseId,
    })

  const [openedAnnouncement, setOpenedAnnouncement] = useState<string>("")

  return (
    <RootPage
      title="Announcements"
      actions={[
        <Restrict
          permission={PERMISSION_COURSE_ANNOUNCEMENTS_CREATE}
          key={"create"}
        >
          <ScopedCommand
            command={{
              id: "Create Announcement",
              name: "Create Announcement",
              group: "Page Actions",
              actionType: "callback",
              action: () => {
                setCreateDialogOpen(true)
              },
            }}
          >
            <Button onClick={() => setCreateDialogOpen(true)}>
              Create Announcement
            </Button>
          </ScopedCommand>
        </Restrict>,
      ]}
    >
      <CreateAnnouncementDialog
        isOpen={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
      />
      <div className="flex flex-col gap-4 mt-8">
        {announcements?.map((announcement) => (
          <Card key={announcement.id} className="px-4 pt-2">
            <Accordion
              open={openedAnnouncement === announcement.id}
              key={announcement.id}
            >
              <AccordionHeader
                onClick={() => {
                  if (openedAnnouncement === announcement.id) {
                    setOpenedAnnouncement("")
                  } else {
                    setOpenedAnnouncement(announcement.id)
                  }
                }}
                className="flex flex-row gap-4 items-center justify-between"
              >
                <Typography variant="h5" className="m-0 flex-1">
                  {announcement.title}
                </Typography>
                <Typography variant="small" className="m-0">
                  {new Date(
                    announcement.dates.visibilityStart || ""
                  ).toLocaleString()}
                </Typography>
              </AccordionHeader>
              <AccordionBody>
                <Markdown
                  className="prose"
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeRaw]}
                >
                  {announcement.content}
                </Markdown>
              </AccordionBody>
            </Accordion>
          </Card>
        ))}
      </div>
    </RootPage>
  )
}
