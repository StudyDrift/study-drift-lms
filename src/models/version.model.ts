export interface Version {
  version: string
  app: string
  isInstalled?: boolean
  isMock?: boolean
}

export interface InstallAppPayload {
  first: string
  last: string
  email: string
  password: string
}
