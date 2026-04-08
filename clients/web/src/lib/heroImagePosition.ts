import type { CSSProperties } from 'react'

/** Parse stored CSS `object-position` (`"x% y%"`) for the positioning UI. */
export function parseHeroObjectPosition(pos: string | null | undefined): { x: number; y: number } {
  if (!pos?.trim()) return { x: 50, y: 50 }
  const m = /^(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%$/.exec(pos.trim())
  if (!m) return { x: 50, y: 50 }
  return {
    x: Math.min(100, Math.max(0, Number(m[1]))),
    y: Math.min(100, Math.max(0, Number(m[2]))),
  }
}

export function formatHeroObjectPosition(x: number, y: number): string {
  return `${Math.round(x)}% ${Math.round(y)}%`
}

export function heroImageObjectStyle(position: string | null | undefined): CSSProperties {
  if (!position?.trim()) return {}
  return { objectPosition: position }
}
