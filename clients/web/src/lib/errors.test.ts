import { describe, expect, it } from 'vitest'
import { readApiErrorMessage } from './errors'

describe('readApiErrorMessage', () => {
  it('reads nested API error message', () => {
    expect(
      readApiErrorMessage({
        error: { code: 'EMAIL_TAKEN', message: 'This email is already registered.' },
      }),
    ).toBe('This email is already registered.')
  })

  it('falls back to top-level message', () => {
    expect(readApiErrorMessage({ message: 'Bad request' })).toBe('Bad request')
  })

  it('returns a generic label when shape is unknown', () => {
    expect(readApiErrorMessage({})).toBe('Request failed')
  })
})
