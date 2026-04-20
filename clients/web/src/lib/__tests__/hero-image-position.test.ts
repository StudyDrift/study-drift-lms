import { describe, expect, it } from 'vitest'
import {
  formatHeroObjectPosition,
  heroImageObjectStyle,
  parseHeroObjectPosition,
} from '../hero-image-position'

describe('parseHeroObjectPosition', () => {
  it('returns center defaults for empty or invalid input', () => {
    expect(parseHeroObjectPosition(null)).toEqual({ x: 50, y: 50 })
    expect(parseHeroObjectPosition(undefined)).toEqual({ x: 50, y: 50 })
    expect(parseHeroObjectPosition('')).toEqual({ x: 50, y: 50 })
    expect(parseHeroObjectPosition('not percentages')).toEqual({ x: 50, y: 50 })
  })

  it('parses "x% y%" pairs', () => {
    expect(parseHeroObjectPosition('25% 75%')).toEqual({ x: 25, y: 75 })
    expect(parseHeroObjectPosition('  0% 100%  ')).toEqual({ x: 0, y: 100 })
  })

  it('clamps parsed percents to 0–100', () => {
    expect(parseHeroObjectPosition('200% 50%')).toEqual({ x: 100, y: 50 })
  })

  it('returns defaults when the string does not match x% y%', () => {
    expect(parseHeroObjectPosition('150% -10%')).toEqual({ x: 50, y: 50 })
  })

  it('accepts decimal percentages', () => {
    expect(parseHeroObjectPosition('33.3% 66.7%')).toEqual({ x: 33.3, y: 66.7 })
  })
})

describe('formatHeroObjectPosition', () => {
  it('rounds to integer percents', () => {
    expect(formatHeroObjectPosition(12.4, 87.6)).toBe('12% 88%')
  })
})

describe('heroImageObjectStyle', () => {
  it('returns empty object when position is missing', () => {
    expect(heroImageObjectStyle(null)).toEqual({})
    expect(heroImageObjectStyle('')).toEqual({})
  })

  it('sets objectPosition when a value is provided', () => {
    expect(heroImageObjectStyle('50% 0%')).toEqual({ objectPosition: '50% 0%' })
  })
})
