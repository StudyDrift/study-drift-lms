import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useCommandPalette } from '../command-palette/use-command-palette'
import { isTypingContextTarget } from '../../lib/keyboard-shortcut-eligible'
import { KeyboardShortcutsContext } from './keyboard-shortcuts-context'
import { KeyboardShortcutsSheet } from './keyboard-shortcuts-sheet'

export function KeyboardShortcutsProvider({ children }: { children: ReactNode }) {
  const { close: closeCommandPalette, isOpen: commandPaletteOpen } = useCommandPalette()
  const paletteOpenRef = useRef(commandPaletteOpen)
  useLayoutEffect(() => {
    paletteOpenRef.current = commandPaletteOpen
  }, [commandPaletteOpen])

  const [sheetOpen, setSheetOpen] = useState(false)

  const openSheet = useCallback(() => {
    if (paletteOpenRef.current) closeCommandPalette()
    setSheetOpen(true)
  }, [closeCommandPalette])

  const closeSheet = useCallback(() => setSheetOpen(false), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?') return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (isTypingContextTarget(e.target)) return
      e.preventDefault()
      setSheetOpen((wasOpen) => {
        if (wasOpen) return false
        if (paletteOpenRef.current) closeCommandPalette()
        return true
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closeCommandPalette])

  const value = useMemo(() => ({ openSheet, closeSheet }), [openSheet, closeSheet])

  return (
    <KeyboardShortcutsContext.Provider value={value}>
      {children}
      <KeyboardShortcutsSheet open={sheetOpen} onClose={closeSheet} />
    </KeyboardShortcutsContext.Provider>
  )
}
