/* eslint-disable react-refresh/only-export-components -- provider + hook live together by convention */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

const ReducedDataContext = createContext(false)

/** True when the user prefers reduced data usage (metered / save-data style browsing). */
export function ReducedDataProvider({ children }: { children: ReactNode }) {
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-data: reduce)')
    const sync = () => {
      setReduced(mq.matches)
      document.documentElement.classList.toggle('lex-reduced-data', mq.matches)
    }
    sync()
    mq.addEventListener('change', sync)
    return () => {
      mq.removeEventListener('change', sync)
      document.documentElement.classList.remove('lex-reduced-data')
    }
  }, [])

  const value = useMemo(() => reduced, [reduced])
  return <ReducedDataContext.Provider value={value}>{children}</ReducedDataContext.Provider>
}

export function useReducedData(): boolean {
  return useContext(ReducedDataContext)
}
