import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { ShellNavContext } from './shell-nav-context-core'

export function ShellNavProvider({ children }: { children: ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [sideNavCollapsed, setSideNavCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem('lextures-sidenav-collapsed') === 'true'
  })

  const closeMobileNav = useCallback(() => setMobileNavOpen(false), [])

  const toggleSideNav = useCallback(() => {
    setSideNavCollapsed((prev) => {
      const next = !prev
      localStorage.setItem('lextures-sidenav-collapsed', String(next))
      return next
    })
  }, [])

  const value = useMemo(
    () => ({
      mobileNavOpen,
      setMobileNavOpen,
      closeMobileNav,
      sideNavCollapsed,
      toggleSideNav,
    }),
    [mobileNavOpen, closeMobileNav, sideNavCollapsed, toggleSideNav],
  )
  return <ShellNavContext.Provider value={value}>{children}</ShellNavContext.Provider>
}
