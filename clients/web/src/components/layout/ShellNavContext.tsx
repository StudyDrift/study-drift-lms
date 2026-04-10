import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react'

type ShellNavContextValue = {
  mobileNavOpen: boolean
  setMobileNavOpen: Dispatch<SetStateAction<boolean>>
  closeMobileNav: () => void
}

const ShellNavContext = createContext<ShellNavContextValue | null>(null)

export function ShellNavProvider({ children }: { children: ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const closeMobileNav = useCallback(() => setMobileNavOpen(false), [])
  const value = useMemo(
    () => ({ mobileNavOpen, setMobileNavOpen, closeMobileNav }),
    [mobileNavOpen, closeMobileNav],
  )
  return <ShellNavContext.Provider value={value}>{children}</ShellNavContext.Provider>
}

export function useShellNav(): ShellNavContextValue {
  const ctx = useContext(ShellNavContext)
  if (!ctx) {
    throw new Error('useShellNav must be used within ShellNavProvider')
  }
  return ctx
}
