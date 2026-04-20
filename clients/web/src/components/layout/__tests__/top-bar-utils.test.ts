import { afterEach, describe, expect, it, vi } from 'vitest'
import { initialsFromName, profileName, shortcutHint } from '../top-bar-utils'

describe('profileName', () => {
  it('returns Profile when profile is null', () => {
    expect(profileName(null)).toBe('Profile')
  })

  it('prefers first + last name', () => {
    expect(
      profileName({
        email: 'a@b.com',
        firstName: '  Ada ',
        lastName: ' Lovelace ',
      }),
    ).toBe('Ada Lovelace')
  })

  it('falls back to display name then email', () => {
    expect(
      profileName({
        email: 'only@example.com',
        displayName: 'Display',
      }),
    ).toBe('Display')
    expect(profileName({ email: 'e@mail.test' })).toBe('e@mail.test')
  })
})

describe('initialsFromName', () => {
  it('returns U for empty or whitespace', () => {
    expect(initialsFromName('')).toBe('U')
    expect(initialsFromName('   ')).toBe('U')
  })

  it('uses one letter for a single word', () => {
    expect(initialsFromName('Madonna')).toBe('M')
  })

  it('uses first letters of first two words', () => {
    expect(initialsFromName('Jean-Luc Picard')).toBe('JP')
  })
})

describe('shortcutHint', () => {
  const nav = globalThis.navigator

  afterEach(() => {
    vi.stubGlobal('navigator', nav)
  })

  it('returns Ctrl+K for non-Apple platforms', () => {
    vi.stubGlobal('navigator', {
      ...nav,
      platform: 'Win32',
      userAgent: 'Mozilla/5.0 Windows',
    })
    expect(shortcutHint()).toBe('Ctrl+K')
  })

  it('returns ⌘K for Mac-like platforms', () => {
    vi.stubGlobal('navigator', {
      ...nav,
      platform: 'MacIntel',
      userAgent: 'Mozilla/5.0 Macintosh',
    })
    expect(shortcutHint()).toBe('⌘K')
  })
})
