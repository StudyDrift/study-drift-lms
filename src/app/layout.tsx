import { Providers } from "@/components/providers"
import { GoogleAnalytics } from "@next/third-parties/google"
import type { Metadata } from "next"
import { Inter } from "next/font/google"
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
        <head>
          <link
            rel="icon"
            type="image/png"
            href="/favicons/favicon-48x48.png"
            sizes="48x48"
          />
          <link rel="icon" type="image/svg+xml" href="/favicons/favicon.svg" />
          <link rel="shortcut icon" href="/favicons/favicon.ico" />
          <link
            rel="apple-touch-icon"
            sizes="180x180"
            href="/favicons/apple-touch-icon.png"
          />
          <link rel="manifest" href="/favicons/site.webmanifest" />
          <GoogleAnalytics gaId="G-0ZL2CH253Y" />
        </head>
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
