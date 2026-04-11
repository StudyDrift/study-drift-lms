import { describe, expect, it } from 'vitest'
import { decodeJwtSub } from './jwtPayload'

function b64urlJson(obj: unknown): string {
  const s = JSON.stringify(obj)
  const b64 = btoa(s)
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

describe('decodeJwtSub', () => {
  it('returns sub from a typical JWT-shaped token', () => {
    const payload = b64urlJson({ sub: '9b2c4f0e-1a2b-4c3d-8e9f-0123456789ab', email: 'a@b.com', exp: 9 })
    const token = `xx.${payload}.yy`
    expect(decodeJwtSub(token)).toBe('9b2c4f0e-1a2b-4c3d-8e9f-0123456789ab')
  })

  it('returns null for invalid tokens', () => {
    expect(decodeJwtSub(null)).toBeNull()
    expect(decodeJwtSub('')).toBeNull()
    expect(decodeJwtSub('not-a-jwt')).toBeNull()
    expect(decodeJwtSub('a.b')).toBeNull()
  })
})
