import { mergeAttributes, Node, type JSONContent, type MarkdownToken } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { MathBlockNodeView, MathInlineNodeView } from './math-node-views'

const blockMathTokenizer = {
  name: 'math_block',
  level: 'block' as const,
  start: (src: string) => src.indexOf('$$'),
  tokenize: (src: string) => {
    const m = /^\$\$\s*([\s\S]*?)\s*\$\$/.exec(src)
    if (!m) return undefined
    return {
      type: 'math_block',
      raw: m[0],
      latex: m[1] ?? '',
    }
  },
}

const inlineMathTokenizer = {
  name: 'math_inline',
  level: 'inline' as const,
  start: (src: string) => {
    let i = 0
    while (i < src.length) {
      const j = src.indexOf('$', i)
      if (j === -1) return -1
      if (src[j + 1] === '$') {
        i = j + 2
        continue
      }
      return j
    }
    return -1
  },
  tokenize: (src: string) => {
    if (src.startsWith('$$')) return undefined
    const m = /^\$((?:\\.|[^$])+)\$/.exec(src)
    if (!m) return undefined
    return {
      type: 'math_inline',
      raw: m[0],
      latex: m[1] ?? '',
    }
  },
}

export const MathInline = Node.create({
  name: 'math_inline',
  group: 'inline',
  inline: true,
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      latex: {
        default: '',
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-latex') ?? '',
        renderHTML: (attrs) => ({ 'data-latex': attrs.latex as string }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-type="math-inline"]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'math-inline',
        'data-latex': String(node.attrs.latex ?? ''),
      }),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathInlineNodeView)
  },

  markdownTokenizer: inlineMathTokenizer,

  parseMarkdown: (token: MarkdownToken) => {
    const latex = typeof token.latex === 'string' ? token.latex : ''
    return { type: 'math_inline', attrs: { latex } } as JSONContent
  },

  renderMarkdown: (node: JSONContent) => {
    const latex = String(node.attrs?.latex ?? '')
    return `$${latex}$`
  },
})

export const MathBlock = Node.create({
  name: 'math_block',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      latex: {
        default: '',
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-latex') ?? '',
        renderHTML: (attrs) => ({ 'data-latex': attrs.latex as string }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="math-block"]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'math-block',
        'data-latex': String(node.attrs.latex ?? ''),
      }),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathBlockNodeView)
  },

  markdownTokenizer: blockMathTokenizer,

  parseMarkdown: (token: MarkdownToken) => {
    const latex = typeof token.latex === 'string' ? token.latex : ''
    return { type: 'math_block', attrs: { latex } } as JSONContent
  },

  renderMarkdown: (node: JSONContent) => {
    const latex = String(node.attrs?.latex ?? '').trimEnd()
    return `$$\n${latex}\n$$`
  },
})
