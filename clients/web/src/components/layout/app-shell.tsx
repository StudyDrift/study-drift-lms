import { Outlet } from 'react-router-dom'
import { CommandPaletteProvider } from '../command-palette/command-palette-provider'
import { CourseFeedUnreadProvider } from '../../context/course-feed-unread-provider'
import { InboxUnreadProvider } from '../../context/inbox-unread-provider'
import { CourseNavFeaturesProvider } from '../../context/course-nav-features-context'
import { ShellNavProvider } from './shell-nav-context'
import { SideNav } from './side-nav'
import { TopBar } from './top-bar'
import { UiThemeSync } from './ui-theme-sync'

export function AppShell() {
  return (
    <InboxUnreadProvider>
      <CourseFeedUnreadProvider>
        <CommandPaletteProvider>
          <ShellNavProvider>
            <CourseNavFeaturesProvider>
              <UiThemeSync />
              <div className="flex h-dvh min-h-0 overflow-hidden bg-slate-50 dark:bg-neutral-950">
                <SideNav />
                <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white dark:bg-neutral-900">
                  <TopBar />
                  <main className="lms-scope flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto dark:bg-neutral-900">
                    <Outlet />
                  </main>
                </div>
              </div>
            </CourseNavFeaturesProvider>
          </ShellNavProvider>
        </CommandPaletteProvider>
      </CourseFeedUnreadProvider>
    </InboxUnreadProvider>
  )
}
