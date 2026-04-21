import { useContext } from 'react'
import { ShellNavContext, type ShellNavContextValue } from './shell-nav-context-core'

export function useShellNav(): ShellNavContextValue {
  const ctx = useContext(ShellNavContext)
  if (!ctx) {
    throw new Error('useShellNav must be used within ShellNavProvider')
  }
  return ctx
}
