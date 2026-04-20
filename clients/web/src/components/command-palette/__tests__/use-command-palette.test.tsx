import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { CommandPaletteProvider } from '../command-palette-provider'
import { useCommandPalette } from '../use-command-palette'

describe('useCommandPalette', () => {
  it('throws when used outside CommandPaletteProvider', () => {
    expect(() => renderHook(() => useCommandPalette())).toThrow(
      /useCommandPalette must be used within CommandPaletteProvider/,
    )
  })

  it('returns open, close, toggle, and isOpen inside the provider', () => {
    function wrapper({ children }: { children: ReactNode }) {
      return <CommandPaletteProvider>{children}</CommandPaletteProvider>
    }
    const { result } = renderHook(() => useCommandPalette(), { wrapper })
    expect(result.current.open).toBeTypeOf('function')
    expect(result.current.close).toBeTypeOf('function')
    expect(result.current.toggle).toBeTypeOf('function')
    expect(result.current.isOpen).toBe(false)
  })
})
