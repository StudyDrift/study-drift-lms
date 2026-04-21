/* eslint-disable react-refresh/only-export-components -- provider + hook live together by convention */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

export type FeatureHelpTopic =
  | 'gradebook'
  | 'modules'
  | 'question-bank'
  | 'quiz-authoring'
  | 'syllabus'
  | 'content-page'

type HelpState = { open: boolean; topic: FeatureHelpTopic | null }

const FeatureHelpContext = createContext<{
  state: HelpState
  openHelp: (topic: FeatureHelpTopic) => void
  closeHelp: () => void
} | null>(null)

export function FeatureHelpProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<HelpState>({ open: false, topic: null })

  const openHelp = useCallback((topic: FeatureHelpTopic) => {
    setState({ open: true, topic })
  }, [])

  const closeHelp = useCallback(() => {
    setState({ open: false, topic: null })
  }, [])

  const value = useMemo(() => ({ state, openHelp, closeHelp }), [state, openHelp, closeHelp])

  return <FeatureHelpContext.Provider value={value}>{children}</FeatureHelpContext.Provider>
}

export function useFeatureHelp() {
  const ctx = useContext(FeatureHelpContext)
  if (!ctx) {
    throw new Error('useFeatureHelp must be used within FeatureHelpProvider')
  }
  return ctx
}
