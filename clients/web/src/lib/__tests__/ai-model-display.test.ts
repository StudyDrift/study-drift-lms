import { describe, expect, it } from 'vitest'
import { formatContextTokens, formatUsdPerMillion } from '../ai-model-display'

describe('formatContextTokens', () => {
  it('returns em dash for null, undefined, or NaN', () => {
    expect(formatContextTokens(null)).toBe('—')
    expect(formatContextTokens(undefined)).toBe('—')
    expect(formatContextTokens(Number.NaN)).toBe('—')
  })

  it('formats values under 1K with locale string', () => {
    expect(formatContextTokens(999)).toMatch(/999/)
  })

  it('formats thousands with K between 1K and 9.99K', () => {
    expect(formatContextTokens(1000)).toBe('1K')
    expect(formatContextTokens(1500)).toBe('1.5K')
  })

  it('formats 10K and above with rounded K until 1M', () => {
    expect(formatContextTokens(10_000)).toBe('10K')
    expect(formatContextTokens(262_144)).toBe('262K')
  })

  it('formats millions with M suffix', () => {
    expect(formatContextTokens(1_000_000)).toBe('1M')
    expect(formatContextTokens(1_500_000)).toBe('1.5M')
  })
})

describe('formatUsdPerMillion', () => {
  it('returns em dash for null, undefined, or NaN', () => {
    expect(formatUsdPerMillion(null)).toBe('—')
    expect(formatUsdPerMillion(undefined)).toBe('—')
    expect(formatUsdPerMillion(Number.NaN)).toBe('—')
  })

  it('returns Free for zero', () => {
    expect(formatUsdPerMillion(0)).toBe('Free')
  })

  it('uses extra decimals for very small positive values', () => {
    expect(formatUsdPerMillion(0.005)).toBe('$0.0050/M')
  })

  it('formats typical per-million rates', () => {
    expect(formatUsdPerMillion(1)).toBe('$1.000/M')
    expect(formatUsdPerMillion(12.34)).toBe('$12.340/M')
  })
})
