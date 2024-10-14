export interface Version {
  version: string
  app: string
}

export interface InstallAppPayload {
  first: string
  last: string
  email: string
  password: string
}
