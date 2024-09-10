"use client"
import { ColorScheme } from "@/models/user-settings.model"
import { useGetUserSettingsQuery } from "@/redux/services/user-settings.api"
import { useEffect } from "react"

export const useColorScheme = (skip?: boolean) => {
  const { data: userSettings, isLoading } = useGetUserSettingsQuery(undefined, {
    skip,
  })

  const colorScheme =
    (userSettings?.colorScheme as ColorScheme) || ColorScheme.System

  useEffect(() => {
    if (skip || isLoading) return
    const colors = [ColorScheme.Light, ColorScheme.Dark, ColorScheme.System]

    // Add the selected and remove the other two
    document.documentElement.classList.add(colorScheme)
    document.documentElement.classList.remove(
      ...colors.filter((c) => c !== colorScheme)
    )
  }, [colorScheme, skip, isLoading])

  return colorScheme
}
