import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { applyUiDensityToDocument, readStoredUiDensity, type UiDensity } from '../lib/ui-density'

const UiDensityContext = createContext<{
  density: UiDensity
  setDensity: (d: UiDensity) => void
} | null>(null)

export function UiDensityProvider({ children }: { children: ReactNode }) {
  const [density, setDensityState] = useState<UiDensity>(() => readStoredUiDensity())

  useLayoutEffect(() => {
    applyUiDensityToDocument(density)
  }, [density])

  const setDensity = useCallback((d: UiDensity) => {
    setDensityState(d)
    applyUiDensityToDocument(d)
  }, [])

  const value = useMemo(() => ({ density, setDensity }), [density, setDensity])

  return <UiDensityContext.Provider value={value}>{children}</UiDensityContext.Provider>
}

/** @see ../lib/ui-density.ts for the `UiDensity` type. */
// eslint-disable-next-line react-refresh/only-export-components -- provider-matched hooks
export function useUiDensity(): UiDensity {
  const ctx = useContext(UiDensityContext)
  return ctx?.density ?? readStoredUiDensity()
}

// eslint-disable-next-line react-refresh/only-export-components -- provider-matched hooks
export function useUiDensityControls() {
  const ctx = useContext(UiDensityContext)
  if (!ctx) {
    throw new Error('useUiDensityControls must be used within UiDensityProvider')
  }
  return ctx
}
