"use client"
import { useGetGlobalAppVersionQuery } from "@/redux/services/versions.api"
import { useEffect, useState } from "react"

export const useInstallHook = () => {
  const { data, isLoading, isSuccess } = useGetGlobalAppVersionQuery()

  useEffect(() => {
    if (!isLoading && isSuccess && !data) {
      window.location.href = "/install"
    }
  }, [isLoading, isSuccess, data])
}

export const useIsInstall = () => {
  const [isInstall, setIsInstall] = useState(false)

  useEffect(() => {
    setIsInstall(window.location.pathname === "/install")
  }, [])

  return isInstall
}
