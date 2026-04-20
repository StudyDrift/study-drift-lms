import { describe, expect, it } from 'vitest'
import { applyMarkdownEdit } from '../markdown-insert'

describe('applyMarkdownEdit', () => {
  it('wraps selection in bold markers', () => {
    const r = applyMarkdownEdit('hello world', 6, 11, 'bold')
    expect(r.value).toBe('hello **world**')
    expect(r.selStart).toBe(8)
    expect(r.selEnd).toBe(13)
  })

  it('wraps selection in italic markers', () => {
    const r = applyMarkdownEdit('ab', 0, 2, 'italic')
    expect(r.value).toBe('*ab*')
  })

  it('wraps inline code', () => {
    const r = applyMarkdownEdit('x = 1', 4, 5, 'inlineCode')
    expect(r.value).toBe('x = `1`')
  })

  it('inserts fenced code block with placeholder when selection empty', () => {
    const r = applyMarkdownEdit('before\nafter', 6, 6, 'codeBlock')
    expect(r.value).toContain('```')
    expect(r.value).toContain('code')
  })

  it('wraps non-empty selection in fenced code block', () => {
    const r = applyMarkdownEdit('a\nLINE\nb', 2, 6, 'codeBlock')
    expect(r.value).toContain('```\nLINE\n```')
  })

  it('prefixes lines with bullet when not already a list', () => {
    const r = applyMarkdownEdit('one\ntwo', 0, 7, 'bulletList')
    expect(r.value).toBe('- one\n- two')
  })

  it('does not double-prefix lines that are already list items', () => {
    const r = applyMarkdownEdit('- a\n- b', 0, 6, 'bulletList')
    expect(r.value).toBe('- a\n- b')
  })

  it('numbers lines for ordered list', () => {
    const r = applyMarkdownEdit('a\nb\nc', 0, 5, 'orderedList')
    expect(r.value).toBe('1. a\n2. b\n3. c')
  })

  it('inserts link with default label and url when selection empty', () => {
    const r = applyMarkdownEdit('text', 4, 4, 'link')
    expect(r.value).toBe('text[link text](https://)')
    expect(r.selStart).toBe(5)
    expect(r.selEnd).toBe(14)
  })

  it('inserts link with custom url', () => {
    const r = applyMarkdownEdit('hi', 0, 2, 'link', 'https://example.com')
    expect(r.value).toBe('[hi](https://example.com)')
    expect(r.selStart).toBe(1)
    expect(r.selEnd).toBe(3)
  })

  it('clamps selection indices to string bounds', () => {
    const r = applyMarkdownEdit('ab', -5, 99, 'bold')
    expect(r.value).toBe('**ab**')
  })
})
