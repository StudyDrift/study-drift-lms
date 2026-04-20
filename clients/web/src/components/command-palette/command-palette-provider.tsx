import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { CommandPaletteContext } from './command-palette-context'
import { CommandPaletteDialog } from './command-palette-dialog'

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [isOpen, setOpen] = useState(false)

  const open = useCallback(() => setOpen(true), [])
  const close = useCallback(() => setOpen(false), [])
  const toggle = useCallback(() => setOpen((v) => !v), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== 'k') return
      const t = e.target as HTMLElement | null
      if (t?.closest?.('[data-no-command-palette]')) return
      e.preventDefault()
      setOpen((v) => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const value = useMemo(
    () => ({
      open,
      close,
      toggle,
      isOpen,
    }),
    [open, close, toggle, isOpen],
  )

  return (
    <CommandPaletteContext.Provider value={value}>
      {children}
      {isOpen && <CommandPaletteDialog />}
    </CommandPaletteContext.Provider>
  )
}
