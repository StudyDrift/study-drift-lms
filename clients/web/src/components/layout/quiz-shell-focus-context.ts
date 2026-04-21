import { createContext, useContext, type ReactNode } from 'react'

export type QuizShellLockdownAccent = 'none' | 'one_at_a_time' | 'kiosk'

export type QuizShellFocusMode = {
  quizTitle: string
  timeRemainingLabel: string | null
  timeUrgent: boolean
  questionProgress: string | null
  saveStatusText: string
  lockdownAccent: QuizShellLockdownAccent
  flaggedForCurrent: boolean
  onToggleFlagForReview: (() => void) | null
}

export type QuizShellFocusContextValue = {
  focus: QuizShellFocusMode | null
  setQuizShellFocus: (next: QuizShellFocusMode | null) => void
}

export const QuizShellFocusContext = createContext<QuizShellFocusContextValue | null>(null)

export function useQuizShellFocus(): QuizShellFocusContextValue {
  const ctx = useContext(QuizShellFocusContext)
  if (!ctx) {
    throw new Error('useQuizShellFocus must be used within QuizShellFocusProvider')
  }
  return ctx
}

/** Present outside the LMS shell (e.g. tests); quiz focus updates are skipped. */
export function useOptionalQuizShellFocus(): QuizShellFocusContextValue | null {
  return useContext(QuizShellFocusContext)
}

export type QuizShellFocusProviderProps = { children: ReactNode }
