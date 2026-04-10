import { describe, expect, it } from 'vitest'
import {
  MARKDOWN_THEME_PRESET_META,
  markdownThemeCustomSeed,
  resolveMarkdownTheme,
} from './markdownTheme'

describe('resolveMarkdownTheme', () => {
  it('uses classic classes for unknown preset id', () => {
    const a = resolveMarkdownTheme('classic', null)
    const b = resolveMarkdownTheme('not-a-real-preset', null)
    expect(b.classes.article).toBe(a.classes.article)
    expect(b.styleOverrides).toEqual({})
  })

  it('merges custom theme with classic base and inline overrides', () => {
    const r = resolveMarkdownTheme('custom', {
      headingColor: '#111111',
      bodyColor: '#222222',
      articleWidth: 'narrow',
    })
    expect(r.styleOverrides.h1?.color).toBe('#111111')
    expect(r.styleOverrides.p?.color).toBe('#222222')
    expect(r.classes.article).toContain('max-w-xl')
  })

  it('applies dark-LMS inline colors when lmsUiDark is true for custom preset', () => {
    const light = resolveMarkdownTheme('custom', markdownThemeCustomSeed, { lmsUiDark: false })
    const dark = resolveMarkdownTheme('custom', markdownThemeCustomSeed, { lmsUiDark: true })
    expect(light.styleOverrides.p?.color).not.toBe(dark.styleOverrides.p?.color)
    expect(dark.styleOverrides.p?.color).toBe('#cbd5e1')
  })

  it('does not double-wrap night preset with LMS dark reading surface', () => {
    const r = resolveMarkdownTheme('night', null, { lmsUiDark: true })
    expect(r.classes.article).not.toContain('!bg-slate-950')
  })

  it('adds LMS dark reading surface for reader preset when lmsUiDark', () => {
    const r = resolveMarkdownTheme('reader', null, { lmsUiDark: true })
    expect(r.classes.article).toContain('!bg-slate-950')
  })

  it('returns preset night without custom style overrides', () => {
    const r = resolveMarkdownTheme('night', null)
    expect(r.styleOverrides).toEqual({})
    expect(r.classes.article).toContain('bg-slate-900')
  })
})

describe('MARKDOWN_THEME_PRESET_META', () => {
  it('lists six presets with ids matching theme keys', () => {
    expect(MARKDOWN_THEME_PRESET_META).toHaveLength(6)
    const ids = new Set(MARKDOWN_THEME_PRESET_META.map((m) => m.id))
    expect(ids.has('classic')).toBe(true)
    expect(ids.has('night')).toBe(true)
  })
})
