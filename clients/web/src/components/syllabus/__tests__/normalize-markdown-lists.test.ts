import { describe, expect, it } from 'vitest'
import { normalizeMarkdownLists } from '../normalize-markdown-lists'

describe('normalizeMarkdownLists', () => {
  it('indents bullets after a top-level 1. block', () => {
    const input = ['1. First', '', '- nested', 'still nested', '', '2. Next'].join('\n')
    const out = normalizeMarkdownLists(input)
    expect(out).toContain('    - nested')
    expect(out).toContain('still nested')
  })

  it('indents ordered lines after a top-level 2. block', () => {
    const input = ['2. Second item', '', '1. nested one', '2. nested two', '', 'Other'].join('\n')
    const out = normalizeMarkdownLists(input)
    expect(out).toContain('    1. nested one')
    expect(out).toContain('    2. nested two')
  })

  it('leaves unrelated markdown unchanged', () => {
    const s = '# Title\n\n- a\n- b\n'
    expect(normalizeMarkdownLists(s)).toBe(s)
  })
})
