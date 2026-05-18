import { type ReactNode } from 'react'
import { NavLink, type NavLinkProps } from 'react-router-dom'
import { sideNavActiveClass, sideNavLinkClass } from './side-nav-styles'
import { useShellNav } from './use-shell-nav'

interface SideNavLinkProps extends NavLinkProps {
  icon: ReactNode
  children: ReactNode
  badge?: ReactNode
}

export function SideNavLink({ icon, children, badge, className, ...props }: SideNavLinkProps) {
  const { sideNavCollapsed } = useShellNav()

  return (
    <NavLink
      {...props}
      className={(navProps) => {
        const baseClass = typeof className === 'function' ? className(navProps) : className
        const activeClass = navProps.isActive ? sideNavActiveClass : ''
        const collapseClass = sideNavCollapsed ? 'justify-center' : ''
        return `${sideNavLinkClass} ${activeClass} ${collapseClass} ${baseClass || ''}`
      }}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center text-current opacity-90">
        {icon}
      </span>
      {!sideNavCollapsed && (
        <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
          <span className="truncate">{children}</span>
          {badge}
        </span>
      )}
      {sideNavCollapsed && badge && (
        <span className="absolute right-2 top-2">
          {badge}
        </span>
      )}
    </NavLink>
  )
}
