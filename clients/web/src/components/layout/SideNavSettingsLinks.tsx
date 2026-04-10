import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { ArrowLeft, Bell, Bot, ChevronDown, Shield, User } from 'lucide-react'
import { settingsViewFromPathname } from './sideNavPathUtils'
import { sideNavActiveClass, sideNavLinkClass } from './sideNavStyles'

export function SideNavSettingsLinks() {
  const location = useLocation()
  const view = settingsViewFromPathname(location.pathname)
  const aiSectionActive = view === 'ai-models' || view === 'ai-prompts'
  const [aiOpen, setAiOpen] = useState(() => location.pathname.startsWith('/settings/ai'))

  useEffect(() => {
    if (location.pathname.startsWith('/settings/ai')) {
      queueMicrotask(() => setAiOpen(true))
    }
  }, [location.pathname])

  return (
    <>
      <NavLink
        to="/"
        end
        className={({ isActive }) => `${sideNavLinkClass} ${isActive ? sideNavActiveClass : ''}`}
      >
        <ArrowLeft className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
        Back
      </NavLink>
      <p className="px-3 pb-1 pt-3 text-sm font-bold tracking-tight text-slate-900 dark:text-slate-100">
        User Settings
      </p>
      <NavLink
        to="/settings/account"
        className={() => `${sideNavLinkClass} ${view === 'account' ? sideNavActiveClass : ''}`}
      >
        <User className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
        Account
      </NavLink>
      <NavLink
        to="/settings/notifications"
        className={() => `${sideNavLinkClass} ${view === 'notifications' ? sideNavActiveClass : ''}`}
      >
        <Bell className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
        Notifications
      </NavLink>
      <p className="px-3 pb-1 pt-4 text-sm font-bold tracking-tight text-slate-900 dark:text-slate-100">
        System Settings
      </p>
      <NavLink
        to="/settings/roles"
        className={() => `${sideNavLinkClass} ${view === 'roles' ? sideNavActiveClass : ''}`}
      >
        <Shield className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
        Roles and Permissions
      </NavLink>
      <div className="flex flex-col gap-0.5">
        <button
          type="button"
          onClick={() => setAiOpen((o) => !o)}
          className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition hover:bg-white hover:text-slate-900 hover:shadow-sm dark:text-slate-300 dark:hover:bg-slate-800/80 dark:hover:text-slate-50 ${
            aiSectionActive ? sideNavActiveClass : 'text-slate-600'
          }`}
          aria-expanded={aiOpen}
        >
          <Bot className="h-5 w-5 shrink-0 text-current opacity-90" aria-hidden />
          <span className="min-w-0 flex-1">Intelligence</span>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-current opacity-70 transition-transform duration-200 ease-out ${
              aiOpen ? 'rotate-180' : 'rotate-0'
            }`}
            aria-hidden
          />
        </button>
        <div
          className={`grid transition-[grid-template-rows] duration-200 ease-out ${
            aiOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
          }`}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="flex flex-col gap-0.5 border-l border-slate-200/80 pl-2 dark:border-slate-600/80">
              <NavLink
                to="/settings/ai/models"
                className={() =>
                  `${sideNavLinkClass} ${view === 'ai-models' ? sideNavActiveClass : ''}`
                }
              >
                Models
              </NavLink>
              <NavLink
                to="/settings/ai/system-prompts"
                className={() =>
                  `${sideNavLinkClass} ${view === 'ai-prompts' ? sideNavActiveClass : ''}`
                }
              >
                System Prompts
              </NavLink>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
