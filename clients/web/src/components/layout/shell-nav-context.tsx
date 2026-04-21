import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { ShellNavContext } from './shell-nav-context-core'

export function ShellNavProvider({ children }: { children: ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const closeMobileNav = useCallback(() => setMobileNavOpen(false), [])
  const value = useMemo(
    () => ({ mobileNavOpen, setMobileNavOpen, closeMobileNav }),
    [mobileNavOpen, closeMobileNav],
  )
  return <ShellNavContext.Provider value={value}>{children}</ShellNavContext.Provider>
}
