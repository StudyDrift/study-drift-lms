import { createContext, type Dispatch, type SetStateAction } from 'react'

export type ShellNavContextValue = {
  mobileNavOpen: boolean
  setMobileNavOpen: Dispatch<SetStateAction<boolean>>
  closeMobileNav: () => void
}

export const ShellNavContext = createContext<ShellNavContextValue | null>(null)
