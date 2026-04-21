import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { CommandPaletteProvider } from '../command-palette/command-palette-provider'
import { KeyboardShortcutsProvider } from '../keyboard-shortcuts/keyboard-shortcuts-provider'
import { CourseFeedUnreadProvider } from '../../context/course-feed-unread-provider'
import { InboxUnreadProvider } from '../../context/inbox-unread-provider'
import { CourseNavFeaturesProvider } from '../../context/course-nav-features-context'
import { QuizFocusTopBar } from './quiz-focus-top-bar'
import { ReadingFocusTopBar } from './reading-focus-top-bar'
import { useQuizShellFocus } from './quiz-shell-focus-context'
import { QuizShellFocusProvider } from './quiz-shell-focus-provider'
import { ReadingShellFocusProvider, useReadingShellFocus } from './reading-shell-focus-context'
import { ShellNavProvider } from './shell-nav-context'
import { SideNav } from './side-nav'
import { TopBar } from './top-bar'
import { UiThemeSync } from './ui-theme-sync'
import { LmsExperienceRoot } from './lms-experience-root'

function AppShellLayout() {
  const location = useLocation()
  const { focus } = useQuizShellFocus()
  const { readingFocus, setReadingFocus } = useReadingShellFocus()
  const hideChrome = Boolean(focus || readingFocus)

  useEffect(() => {
    setReadingFocus(false)
  }, [location.pathname, setReadingFocus])

  return (
    <CourseNavFeaturesProvider>
      <LmsExperienceRoot>
      <UiThemeSync />
      <div
        className={`flex h-dvh min-h-0 overflow-hidden bg-slate-50 dark:bg-neutral-950 ${
          focus ? 'ring-2 ring-inset ring-indigo-900/35 dark:ring-amber-400/25' : ''
        }`}
      >
        {!hideChrome ? <SideNav /> : null}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white dark:bg-neutral-900">
          {focus ? (
            <QuizFocusTopBar model={focus} />
          ) : readingFocus ? (
            <ReadingFocusTopBar />
          ) : (
            <TopBar />
          )}
          <main className="lms-scope lms-print-root flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto dark:bg-neutral-900">
            <Outlet />
          </main>
        </div>
      </div>
      </LmsExperienceRoot>
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
                <ReadingShellFocusProvider>
                  <AppShellLayout />
                </ReadingShellFocusProvider>
              </QuizShellFocusProvider>
            </ShellNavProvider>
          </KeyboardShortcutsProvider>
        </CommandPaletteProvider>
      </CourseFeedUnreadProvider>
    </InboxUnreadProvider>
  )
}
