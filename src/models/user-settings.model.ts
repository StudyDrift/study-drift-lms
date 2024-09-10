export interface UserSettings {
  userId: string
  colorScheme?: string
  language?: string
}

export type UpdateUserSettingsPayload = Omit<UserSettings, "userId">

export enum ColorScheme {
  Light = "light",
  Dark = "dark",
  System = "system",
}
