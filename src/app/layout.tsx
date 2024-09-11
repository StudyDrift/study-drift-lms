import type { Metadata } from "next"
import { Inter } from "next/font/google"

import { Providers } from "@/components/providers"
import React from "react"
import "../styles/globals.css"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "Study Drift",
  description: "The student-first learning platform for instructors",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <React.StrictMode>
      <html lang="en" suppressHydrationWarning>
        <body
          className={
            inter.className +
            " flex h-screen w-screen flex-row bg-gray-100/60 dark:bg-gray-900/75"
          }
        >
          <Providers>{children}</Providers>
        </body>
      </html>
    </React.StrictMode>
  )
}
