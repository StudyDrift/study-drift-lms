import { Outlet } from 'react-router-dom'
import { CommandPaletteProvider } from '../command-palette/CommandPaletteProvider'
import { InboxUnreadProvider } from '../../context/InboxUnreadProvider'
import { SideNav } from './SideNav'
import { TopBar } from './TopBar'
import { UiThemeSync } from './UiThemeSync'

export function AppShell() {
  return (
    <InboxUnreadProvider>
      <CommandPaletteProvider>
        <UiThemeSync />
        <div className="flex h-screen min-h-0 overflow-hidden bg-slate-50 dark:bg-slate-950">
          <SideNav />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white dark:bg-slate-900">
            <TopBar />
            <main className="lms-scope min-h-0 flex-1 overflow-auto dark:bg-slate-900">
              <Outlet />
            </main>
          </div>
        </div>
      </CommandPaletteProvider>
    </InboxUnreadProvider>
  )
}
