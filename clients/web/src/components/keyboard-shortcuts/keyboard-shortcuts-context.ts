import { createContext, useContext } from 'react'

export type KeyboardShortcutsContextValue = {
  openSheet: () => void
  closeSheet: () => void
}

export const KeyboardShortcutsContext = createContext<KeyboardShortcutsContextValue | null>(null)

export function useKeyboardShortcutsSheet(): KeyboardShortcutsContextValue {
  const ctx = useContext(KeyboardShortcutsContext)
  if (!ctx) {
    throw new Error('useKeyboardShortcutsSheet must be used within KeyboardShortcutsProvider')
  }
  return ctx
}
