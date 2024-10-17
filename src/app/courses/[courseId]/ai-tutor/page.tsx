"use client"
import { Window } from "@/components/chat/window"
import { RootPage } from "@/components/root-page"
import { Typography } from "@material-tailwind/react"

export default function Page() {
  return (
    <RootPage title="AI Tutor">
      <Typography>
        Chat with all of the content you have access to in the course.
      </Typography>
      <Window />
    </RootPage>
  )
}
