import { Outlet } from 'react-router-dom'
import { CommandPaletteProvider } from '../command-palette/CommandPaletteProvider'
import { InboxUnreadProvider } from '../../context/InboxUnreadProvider'
import { SideNav } from './SideNav'
import { TopBar } from './TopBar'

export function AppShell() {
  return (
    <InboxUnreadProvider>
      <CommandPaletteProvider>
        <div className="flex min-h-screen bg-slate-50">
          <SideNav />
          <div className="flex min-h-screen min-w-0 flex-1 flex-col bg-white">
            <TopBar />
            <main className="min-h-0 flex-1 overflow-auto">
              <Outlet />
            </main>
          </div>
        </div>
      </CommandPaletteProvider>
    </InboxUnreadProvider>
  )
}
