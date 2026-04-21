import { Outlet } from 'react-router-dom'
import { CommandPaletteProvider } from '../command-palette/command-palette-provider'
import { KeyboardShortcutsProvider } from '../keyboard-shortcuts/keyboard-shortcuts-provider'
import { CourseFeedUnreadProvider } from '../../context/course-feed-unread-provider'
import { InboxUnreadProvider } from '../../context/inbox-unread-provider'
import { CourseNavFeaturesProvider } from '../../context/course-nav-features-context'
import { QuizFocusTopBar } from './quiz-focus-top-bar'
import { useQuizShellFocus } from './quiz-shell-focus-context'
import { QuizShellFocusProvider } from './quiz-shell-focus-provider'
import { ShellNavProvider } from './shell-nav-context'
import { SideNav } from './side-nav'
import { TopBar } from './top-bar'
import { UiThemeSync } from './ui-theme-sync'

function AppShellLayout() {
  const { focus } = useQuizShellFocus()

  return (
    <CourseNavFeaturesProvider>
      <UiThemeSync />
      <div
        className={`flex h-dvh min-h-0 overflow-hidden bg-slate-50 dark:bg-neutral-950 ${
          focus ? 'ring-2 ring-inset ring-indigo-900/35 dark:ring-amber-400/25' : ''
        }`}
      >
        {!focus ? <SideNav /> : null}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white dark:bg-neutral-900">
          {focus ? <QuizFocusTopBar model={focus} /> : <TopBar />}
          <main className="lms-scope flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto dark:bg-neutral-900">
            <Outlet />
          </main>
        </div>
      </div>
    </CourseNavFeaturesProvider>
  )
}

export function AppShell() {
  return (
    <InboxUnreadProvider>
      <CourseFeedUnreadProvider>
        <CommandPaletteProvider>
          <KeyboardShortcutsProvider>
            <ShellNavProvider>
              <QuizShellFocusProvider>
                <AppShellLayout />
              </QuizShellFocusProvider>
            </ShellNavProvider>
          </KeyboardShortcutsProvider>
        </CommandPaletteProvider>
      </CourseFeedUnreadProvider>
    </InboxUnreadProvider>
  )
}
