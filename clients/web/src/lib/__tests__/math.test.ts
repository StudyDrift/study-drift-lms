import { describe, expect, it } from 'vitest'
import { parseMathDelimitedText } from '../../components/math/math-plain-text-utils'
import { renderKatexSafe } from '../math'

describe('parseMathDelimitedText', () => {
  it('splits inline and display math', () => {
    const s = 'Solve $\\frac{a}{b}$ and $$\\int_0^1 x\\,dx$$ today.'
    const segs = parseMathDelimitedText(s)
    expect(segs).toEqual([
      { kind: 'text', text: 'Solve ' },
      { kind: 'inline', latex: '\\frac{a}{b}' },
      { kind: 'text', text: ' and ' },
      { kind: 'display', latex: '\\int_0^1 x\\,dx' },
      { kind: 'text', text: ' today.' },
    ])
  })

  it('treats unclosed dollar as text', () => {
    const segs = parseMathDelimitedText('bad $ unclosed')
    expect(segs.some((x) => x.kind === 'inline')).toBe(false)
  })
})

describe('renderKatexSafe', () => {
  it('returns code fallback for malformed LaTeX without throwing', async () => {
    const katex = (await import('katex')).default
    const r = renderKatexSafe(katex, '\\frac{a}{', false)
    expect(r.failed).toBe(true)
    expect(r.html).toContain('katex-error-fallback')
    expect(r.html).toContain('\\frac{a}{')
  })

  it('renders valid fraction', async () => {
    const katex = (await import('katex')).default
    const r = renderKatexSafe(katex, '\\frac{a}{b}', false)
    expect(r.failed).toBe(false)
    expect(r.html).toContain('katex')
  })
})
