import { describe, expect, it } from 'vitest'
import { markdownToSectionsForEditor, sectionsToMarkdown } from '../syllabus-section-markdown'

describe('sectionsToMarkdown', () => {
  it('joins sections with ## headings and double newlines', () => {
    const md = sectionsToMarkdown([
      { id: '1', heading: 'A', markdown: 'Body one.' },
      { id: '2', heading: 'B', markdown: 'Body two.' },
    ])
    expect(md).toBe('## A\n\nBody one.\n\n## B\n\nBody two.')
  })

  it('trims trailing body whitespace only and skips empty heading in output', () => {
    const md = sectionsToMarkdown([
      { id: '1', heading: '', markdown: '  solo  \n' },
      { id: '2', heading: '  ', markdown: 'x' },
    ])
    expect(md).toBe('  solo\n\nx')
  })
})

describe('markdownToSectionsForEditor', () => {
  it('returns one empty section for blank input', () => {
    const sections = markdownToSectionsForEditor('', () => 'only-id')
    expect(sections).toHaveLength(1)
    expect(sections[0]).toEqual({ id: 'only-id', heading: '', markdown: '' })
  })

  it('splits on ## headings into multiple sections', () => {
    const ids = ['x', 'y', 'z']
    let i = 0
    const sections = markdownToSectionsForEditor(
      '## Intro\n\nHello\n\n## Outro\n\nBye',
      () => ids[i++]!,
    )
    expect(sections).toHaveLength(2)
    expect(sections[0]).toMatchObject({ heading: 'Intro', markdown: 'Hello' })
    expect(sections[1]).toMatchObject({ heading: 'Outro', markdown: 'Bye' })
  })

  it('parses first chunk without leading ## as heading-only body', () => {
    const sections = markdownToSectionsForEditor('Plain intro line', () => 'id1')
    expect(sections).toHaveLength(1)
    expect(sections[0]).toEqual({ id: 'id1', heading: '', markdown: 'Plain intro line' })
  })
})
