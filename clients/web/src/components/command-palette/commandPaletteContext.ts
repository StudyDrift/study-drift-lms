import { createContext } from 'react'

export type CommandPaletteContextValue = {
  open: () => void
  close: () => void
  toggle: () => void
  isOpen: boolean
}

export const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(null)
