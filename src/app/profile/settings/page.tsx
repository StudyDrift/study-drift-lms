"use client"
import { RootPage } from "@/components/root-page"
import { ColorScheme } from "@/models/user-settings.model"
import {
  useGetUserSettingsQuery,
  useUpdateUserSettingsMutation,
} from "@/redux/services/user-settings.api"
import {
  Button,
  Card,
  CardBody,
  Option,
  Select,
  Typography,
} from "@material-tailwind/react"
import { useEffect, useRef, useState } from "react"

export default function Page() {
  const { data: userSettings, isLoading: isUserSettingsLoading } =
    useGetUserSettingsQuery()

  const [updateSettings, { isLoading: isUpdateLoading }] =
    useUpdateUserSettingsMutation()

  const [colorScheme, setColorScheme] = useState<ColorScheme>()

  const isSet = useRef(false)

  const handleUpdate = async () => {
    updateSettings({
      ...(userSettings || {}),
      colorScheme: colorScheme || ColorScheme.System,
    })
  }

  useEffect(() => {
    if (!isUserSettingsLoading && !isSet.current) {
      isSet.current = true
      setColorScheme(
        (userSettings?.colorScheme as ColorScheme) || ColorScheme.System
      )
    }
  }, [userSettings, isUserSettingsLoading])

  return (
    <RootPage
      title="Settings"
      isLoading={isUserSettingsLoading}
      actions={[
        <Button key="save" onClick={handleUpdate} loading={isUpdateLoading}>
          Save Settings
        </Button>,
      ]}
    >
      <Card className="max-w-2xl mt-4 mb-20">
        <CardBody>
          <Typography variant="h5" className="mb-4">
            Display Settings
          </Typography>
          <Select
            label="Color Scheme"
            value={colorScheme}
            onChange={(e) => setColorScheme(e as ColorScheme)}
          >
            {/* <Option value={ColorScheme.System}>System</Option> */}
            <Option value={ColorScheme.Light}>Light</Option>
            <Option value={ColorScheme.Dark}>Dark</Option>
          </Select>
        </CardBody>
      </Card>
    </RootPage>
  )
}
