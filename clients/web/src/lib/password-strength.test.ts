import { describe, expect, it } from 'vitest'
import { passwordStrengthEnglish, passwordStrengthKey } from './password-strength'

describe('passwordStrengthKey', () => {
  it('marks short passwords weak', () => {
    expect(passwordStrengthKey('abc')).toBe('password.strength.weak')
  })
  it('marks medium multi-class fair', () => {
    expect(passwordStrengthKey('Abcd1234')).toBe('password.strength.fair')
  })
  it('marks long multi-class strong', () => {
    expect(passwordStrengthKey('Abcdefghijkl1!')).toBe('password.strength.strong')
  })
})

describe('passwordStrengthEnglish', () => {
  it('returns labels for WCAG text alternative', () => {
    expect(passwordStrengthEnglish('password.strength.weak')).toBe('Weak')
  })
})
