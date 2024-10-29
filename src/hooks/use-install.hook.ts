"use client"
import { useGetGlobalAppVersionQuery } from "@/redux/services/versions.api"
import { useEffect, useState } from "react"

export const useInstallHook = () => {
  const { data, isLoading, isSuccess } = useGetGlobalAppVersionQuery()

  useEffect(() => {
    if (!isLoading && isSuccess && (!data || !data.isInstalled)) {
      console.log("here")
      window.location.href = `/install?mock=${data.isMock ? "1" : "0"}`
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
