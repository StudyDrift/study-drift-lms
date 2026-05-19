import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useOrgRoleCapabilities } from '../../hooks/use-org-role-capabilities'
import {
  ArrowLeft,
  Bell,
  Bot,
  Building2,
  CalendarRange,
  ChevronDown,
  FolderTree,
  Link2,
  Palette,
  Plug,
  Settings2,
  Shield,
  User,
} from 'lucide-react'
import { usePermissions } from '../../context/use-permissions'
import { usePlatformScimEnabled } from '../../hooks/use-platform-scim-enabled'
import {
  PERM_RBAC_MANAGE,
  PERM_TENANT_ORG_ROLES_MANAGE,
  PERM_TENANT_ORG_ROLES_VIEW,
  PERM_TENANT_ORG_UNITS_ADMIN,
} from '../../lib/rbac-api'
import { settingsViewFromPathname } from './side-nav-path-utils'
import { sideNavActiveClass, sideNavLinkClass } from './side-nav-styles'
import { SideNavLink } from './side-nav-link'
import { useShellNav } from './use-shell-nav'

export function SideNavSettingsLinks() {
  const { allows, loading: permLoading } = usePermissions()
  const { sideNavCollapsed } = useShellNav()
  const canManageRbac = !permLoading && allows(PERM_RBAC_MANAGE)
  const orgRoleCaps = useOrgRoleCapabilities()
  const canOrgRolesNav =
    canManageRbac || (!orgRoleCaps.loading && orgRoleCaps.canManageOrgRoleGrants)
  const canOrgUnits = !permLoading && (canManageRbac || allows(PERM_TENANT_ORG_UNITS_ADMIN))
  const canOrgRoles =
    !permLoading && (allows(PERM_TENANT_ORG_ROLES_MANAGE) || allows(PERM_TENANT_ORG_ROLES_VIEW))
  const { scimEnabled: platformScimEnabled } = usePlatformScimEnabled(canManageRbac)
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
      <SideNavLink to="/" icon={<ArrowLeft className="h-5 w-5" />} end>
        Back
      </SideNavLink>
      {!sideNavCollapsed && (
        <p className="px-3 pb-1 pt-3 text-sm font-bold tracking-tight text-slate-900 dark:text-neutral-100">
          User Settings
        </p>
      )}
      <SideNavLink
        to="/settings/account"
        className={() => (view === 'account' ? sideNavActiveClass : '')}
        icon={<User className="h-5 w-5" />}
      >
        Account
      </SideNavLink>
      <SideNavLink
        to="/settings/notifications"
        className={() => (view === 'notifications' ? sideNavActiveClass : '')}
        icon={<Bell className="h-5 w-5" />}
      >
        Notifications
      </SideNavLink>
      {(canOrgUnits || canOrgRoles || canManageRbac || canOrgRolesNav) && (
        <>
          {!sideNavCollapsed && (
            <p className="px-3 pb-1 pt-4 text-sm font-bold tracking-tight text-slate-900 dark:text-neutral-100">
              System Settings
            </p>
          )}
          {(canOrgUnits || canOrgRoles || canOrgRolesNav) && (
            <>
              {canOrgUnits && (
                <SideNavLink
                  to="/settings/org-units"
                  className={() => (view === 'org-units' ? sideNavActiveClass : '')}
                  icon={<FolderTree className="h-5 w-5" />}
                >
                  Org structure
                </SideNavLink>
              )}
              {(canOrgRoles || canOrgRolesNav) && (
                <SideNavLink
                  to="/settings/org-roles"
                  className={() => (view === 'org-roles' ? sideNavActiveClass : '')}
                  icon={<Shield className="h-5 w-5" />}
                >
                  Roles &amp; permissions
                </SideNavLink>
              )}
              {(canOrgUnits || canOrgRoles) && (
                <>
                  <SideNavLink
                    to="/settings/terms"
                    className={() => (view === 'terms' ? sideNavActiveClass : '')}
                    icon={<CalendarRange className="h-5 w-5" />}
                  >
                    Academic terms
                  </SideNavLink>
                  <SideNavLink
                    to="/settings/org-branding"
                    className={() => (view === 'org-branding' ? sideNavActiveClass : '')}
                    icon={<Palette className="h-5 w-5" />}
                  >
                    Branding
                  </SideNavLink>
                </>
              )}
            </>
          )}
          {canManageRbac && (
            <>
              <SideNavLink
                to="/settings/roles"
                className={() => (view === 'roles' ? sideNavActiveClass : '')}
                icon={<Shield className="h-5 w-5" />}
              >
                Roles and Permissions
              </SideNavLink>
              <SideNavLink
                to="/settings/lti-tools"
                className={() => (view === 'lti-tools' ? sideNavActiveClass : '')}
                icon={<Plug className="h-5 w-5" />}
              >
                LTI tools
              </SideNavLink>
              <SideNavLink
                to="/settings/platform"
                className={() => (view === 'platform' ? sideNavActiveClass : '')}
                icon={<Settings2 className="h-5 w-5" />}
              >
                Global platform
              </SideNavLink>
              <SideNavLink
                to="/settings/organizations"
                className={() => (view === 'organizations' ? sideNavActiveClass : '')}
                icon={<Building2 className="h-5 w-5" />}
              >
                Organizations
              </SideNavLink>
              {platformScimEnabled && (
                <SideNavLink
                  to="/settings/scim-provisioning"
                  className={() => (view === 'scim-provisioning' ? sideNavActiveClass : '')}
                  icon={<Link2 className="h-5 w-5" />}
                >
                  SCIM provisioning
                </SideNavLink>
              )}
              <div className="flex flex-col gap-0.5">
                <button
                  type="button"
                  onClick={() => setAiOpen((o) => !o)}
                  className={`${sideNavLinkClass} ${
                    sideNavCollapsed ? 'justify-center' : ''
                  } ${aiSectionActive ? sideNavActiveClass : 'text-slate-500'}`}
                  aria-expanded={aiOpen}
                  title={sideNavCollapsed ? 'Intelligence' : undefined}
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center text-current opacity-90">
                    <Bot className="h-5 w-5" aria-hidden />
                  </span>
                  {!sideNavCollapsed && (
                    <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                      <span className="truncate">Intelligence</span>
                      <ChevronDown
                        className={`h-4 w-4 shrink-0 text-current opacity-70 transition-transform duration-200 ease-out ${
                          aiOpen ? 'rotate-180' : 'rotate-0'
                        }`}
                        aria-hidden
                      />
                    </span>
                  )}
                </button>
                {!sideNavCollapsed && (
                  <div
                    className={`grid transition-[grid-template-rows] duration-200 ease-out ${
                      aiOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
                    }`}
                  >
                    <div className="min-h-0 overflow-hidden">
                      <div className="flex flex-col gap-0.5 border-l border-slate-200/80 pl-2 dark:border-neutral-600/80">
                        <SideNavLink
                          to="/settings/ai/models"
                          className={() => (view === 'ai-models' ? sideNavActiveClass : '')}
                          icon={null}
                        >
                          Models
                        </SideNavLink>
                        <SideNavLink
                          to="/settings/ai/system-prompts"
                          className={() => (view === 'ai-prompts' ? sideNavActiveClass : '')}
                          icon={null}
                        >
                          System Prompts
                        </SideNavLink>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
    </>
  )
}
