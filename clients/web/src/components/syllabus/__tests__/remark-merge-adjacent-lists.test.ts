import { describe, expect, it } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import { visit } from 'unist-util-visit'
import type { List, Root } from 'mdast'
import { remarkMergeAdjacentLists } from '../remark-merge-adjacent-lists'
import { normalizeMarkdownLists } from '../normalize-markdown-lists'

function countRootLevelLists(tree: { children: unknown[] }): number {
  let n = 0
  for (const c of tree.children) {
    if (c && typeof c === 'object' && (c as List).type === 'list') n++
  }
  return n
}

function countOl(tree: unknown): number {
  let n = 0
  visit(tree as never, 'list', (node: List) => {
    if (node.ordered) n++
  })
  return n
}

describe('normalizeMarkdownLists + remarkMergeAdjacentLists', () => {
  it('turns flat LMS-style lists into one ol with nested ul and nested ol', () => {
    const md = `1. Install your favorite IDE or CLI tool. I would recommend one of the following:

- Github Copilot
- Claude Code

2. Due to the nature of this course, you will be required to upgrade.

1. Students may receive Github Copilot pro for free
2. Students may receive Cursor Pro for free for one year
3. Claude by Anthropic costs $20/mo
`

    const normalized = normalizeMarkdownLists(md)
    const proc = unified().use(remarkParse).use(remarkGfm).use(remarkMergeAdjacentLists)
    const after = proc.runSync(proc.parse(normalized)) as Root

    expect(countRootLevelLists(after)).toBe(1)
    expect(countOl(after)).toBe(2)
    expect(normalized).toContain('    - Github')
    expect(normalized).toContain('    1. Students')
  })
})
