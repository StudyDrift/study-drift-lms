import { createContext } from 'react'

export type PermissionsContextValue = {
  permissionStrings: string[]
  loading: boolean
  error: string | null
  allows: (required: string) => boolean
  refresh: () => Promise<void>
}

export const PermissionsContext = createContext<PermissionsContextValue | null>(null)
