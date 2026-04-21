/* eslint-disable react-refresh/only-export-components -- context module exports provider + hooks */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

type ReadingShellFocusContextValue = {
  readingFocus: boolean
  setReadingFocus: (next: boolean) => void
}

const ReadingShellFocusContext = createContext<ReadingShellFocusContextValue | null>(null)

export function ReadingShellFocusProvider({ children }: { children: ReactNode }) {
  const [readingFocus, setReadingFocusState] = useState(false)
  const setReadingFocus = useCallback((next: boolean) => {
    setReadingFocusState(next)
  }, [])
  const value = useMemo(
    () => ({ readingFocus, setReadingFocus }),
    [readingFocus, setReadingFocus],
  )
  return (
    <ReadingShellFocusContext.Provider value={value}>{children}</ReadingShellFocusContext.Provider>
  )
}

export function useReadingShellFocus(): ReadingShellFocusContextValue {
  const ctx = useContext(ReadingShellFocusContext)
  if (!ctx) {
    throw new Error('useReadingShellFocus must be used within ReadingShellFocusProvider')
  }
  return ctx
}
