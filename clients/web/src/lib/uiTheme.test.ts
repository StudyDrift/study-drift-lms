import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyUiTheme, parseUiTheme, type UiTheme } from './uiTheme'

describe('parseUiTheme', () => {
  it('returns dark only for exact dark token (case-insensitive, trimmed)', () => {
    expect(parseUiTheme('dark')).toBe('dark')
    expect(parseUiTheme('  DARK  ')).toBe('dark')
  })

  it('returns light for undefined, empty, or any other value', () => {
    expect(parseUiTheme(undefined)).toBe('light')
    expect(parseUiTheme(null)).toBe('light')
    expect(parseUiTheme('')).toBe('light')
    expect(parseUiTheme('light')).toBe('light')
    expect(parseUiTheme('auto')).toBe('light')
  })
})

describe('applyUiTheme', () => {
  let root: HTMLElement

  beforeEach(() => {
    root = document.documentElement
    root.classList.remove('dark')
    root.style.colorScheme = ''
  })

  afterEach(() => {
    root.classList.remove('dark')
    root.style.colorScheme = ''
  })

  function expectTheme(theme: UiTheme) {
    expect(root.classList.contains('dark')).toBe(theme === 'dark')
    expect(root.style.colorScheme).toBe(theme === 'dark' ? 'dark' : 'light')
  }

  it('toggles dark class and color-scheme for dark theme', () => {
    applyUiTheme('dark')
    expectTheme('dark')
  })

  it('removes dark class for light theme', () => {
    root.classList.add('dark')
    applyUiTheme('light')
    expectTheme('light')
  })
})
