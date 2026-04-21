import { useCallback, useMemo, useState } from 'react'
import { QuizShellFocusContext, type QuizShellFocusMode, type QuizShellFocusProviderProps } from './quiz-shell-focus-context'

export function QuizShellFocusProvider({ children }: QuizShellFocusProviderProps) {
  const [focus, setFocus] = useState<QuizShellFocusMode | null>(null)
  const setQuizShellFocus = useCallback((next: QuizShellFocusMode | null) => {
    setFocus(next)
  }, [])
  const value = useMemo(() => ({ focus, setQuizShellFocus }), [focus, setQuizShellFocus])
  return <QuizShellFocusContext.Provider value={value}>{children}</QuizShellFocusContext.Provider>
}
