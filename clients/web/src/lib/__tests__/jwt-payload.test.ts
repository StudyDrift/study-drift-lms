import { describe, expect, it } from 'vitest'
import { decodeJwtPayload, decodeJwtSub } from '../jwt-payload'

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

  it('decodeJwtPayload returns org_id when present', () => {
    const payload = b64urlJson({
      sub: '9b2c4f0e-1a2b-4c3d-8e9f-0123456789ab',
      org_id: 'a0000000-0000-4000-8000-0000000000a0',
      org_slug: 'default',
    })
    const token = `xx.${payload}.yy`
    const p = decodeJwtPayload(token)
    expect(p?.org_id).toBe('a0000000-0000-4000-8000-0000000000a0')
    expect(p?.org_slug).toBe('default')
  })

  it('returns null for invalid tokens', () => {
    expect(decodeJwtSub(null)).toBeNull()
    expect(decodeJwtSub('')).toBeNull()
    expect(decodeJwtSub('not-a-jwt')).toBeNull()
    expect(decodeJwtSub('a.b')).toBeNull()
  })
})
