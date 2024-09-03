"use client"
import { Typography } from "@material-tailwind/react"
import React, { PropsWithChildren } from "react"
import { SideNav } from "../sidenav"

interface PageProps extends PropsWithChildren {
  title?: string
  actions?: React.ReactNode[]
}

export const RootPage = ({ children, title, actions = [] }: PageProps) => {
  return (
    <div>
      <SideNav />
      <main className="pl-[21rem] py-4 pr-4 flex-1 w-screen">
        {title && (
          <div className="flex justify-between flex-row w-full">
            <Typography variant="h3" className="flex-1">
              {title}
            </Typography>
            <div className="flex gap-2">{actions}</div>
          </div>
        )}
        {children}
      </main>
    </div>
  )
}
