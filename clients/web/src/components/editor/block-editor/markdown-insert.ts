/** Apply markdown transforms at the given selection; returns new value + selection range. */

export type MarkdownEditKind =
  | 'bold'
  | 'italic'
  | 'inlineCode'
  | 'codeBlock'
  | 'bulletList'
  | 'orderedList'
  | 'link'

export function applyMarkdownEdit(
  markdown: string,
  selStart: number,
  selEnd: number,
  kind: MarkdownEditKind,
  linkUrl?: string,
): { value: string; selStart: number; selEnd: number } {
  const start = Math.max(0, Math.min(selStart, markdown.length))
  const end = Math.max(0, Math.min(selEnd, markdown.length))

  switch (kind) {
    case 'bold':
      return wrap(markdown, start, end, '**', '**')
    case 'italic':
      return wrap(markdown, start, end, '*', '*')
    case 'inlineCode':
      return wrap(markdown, start, end, '`', '`')
    case 'codeBlock':
      return wrapCodeBlock(markdown, start, end)
    case 'bulletList':
      return prefixLines(markdown, start, end, '- ')
    case 'orderedList':
      return orderedList(markdown, start, end)
    case 'link':
      return insertLink(markdown, start, end, linkUrl)
    default:
      return { value: markdown, selStart: start, selEnd: end }
  }
}

function wrap(
  text: string,
  start: number,
  end: number,
  open: string,
  close: string,
): { value: string; selStart: number; selEnd: number } {
  const selected = text.slice(start, end)
  const insertion = text.slice(0, start) + open + selected + close + text.slice(end)
  const newStart = start + open.length
  const newEnd = newStart + selected.length
  return { value: insertion, selStart: newStart, selEnd: newEnd }
}

function wrapCodeBlock(
  text: string,
  start: number,
  end: number,
): { value: string; selStart: number; selEnd: number } {
  const selected = text.slice(start, end)
  const body = selected.trim() ? selected : 'code'
  const open = '```\n'
  const close = '\n```'
  const insertion = text.slice(0, start) + open + body + close + text.slice(end)
  const newStart = start + open.length
  const newEnd = newStart + body.length
  return { value: insertion, selStart: newStart, selEnd: newEnd }
}

/** First line start through end of line that contains `end` (exclusive of trailing newline). */
function expandToLineBlock(text: string, start: number, end: number): { lineStart: number; blockEnd: number } {
  const lineStart = text.lastIndexOf('\n', Math.max(0, start - 1)) + 1
  const blockEnd = text.indexOf('\n', Math.max(0, end - 1))
  const blockEndResolved = blockEnd === -1 ? text.length : blockEnd
  return { lineStart, blockEnd: blockEndResolved }
}

function prefixLines(
  text: string,
  start: number,
  end: number,
  prefix: string,
): { value: string; selStart: number; selEnd: number } {
  const { lineStart, blockEnd } = expandToLineBlock(text, start, end)
  const block = text.slice(lineStart, blockEnd)
  if (block.length === 0) {
    const insertion = text.slice(0, lineStart) + prefix + text.slice(lineStart)
    const p = lineStart + prefix.length
    return { value: insertion, selStart: p, selEnd: p }
  }
  const lines = block.split('\n')
  const fixed = lines.map((line) => {
    if (line.trim() === '') return line
    if (/^\s*([-*]|\d+\.)\s/.test(line)) return line
    const m = line.match(/^(\s*)(.*)$/)
    if (!m) return line
    return `${m[1]}${prefix}${m[2]}`
  })
  const newBlock = fixed.join('\n')
  const insertion = text.slice(0, lineStart) + newBlock + text.slice(blockEnd)
  const delta = newBlock.length - block.length
  return { value: insertion, selStart: start, selEnd: end + delta }
}

function orderedList(
  text: string,
  start: number,
  end: number,
): { value: string; selStart: number; selEnd: number } {
  const { lineStart, blockEnd } = expandToLineBlock(text, start, end)
  const block = text.slice(lineStart, blockEnd)
  if (block.length === 0) {
    const insertion = text.slice(0, lineStart) + '1. ' + text.slice(lineStart)
    const p = lineStart + 3
    return { value: insertion, selStart: p, selEnd: p }
  }
  const lines = block.split('\n')
  let n = 1
  const fixed = lines.map((line) => {
    if (line.trim() === '') return line
    if (/^\s*([-*]|\d+\.)\s/.test(line)) return line
    const m = line.match(/^(\s*)(.*)$/)
    if (!m) return line
    const out = `${m[1]}${n}. ${m[2]}`
    n += 1
    return out
  })
  const newBlock = fixed.join('\n')
  const insertion = text.slice(0, lineStart) + newBlock + text.slice(blockEnd)
  const delta = newBlock.length - block.length
  return { value: insertion, selStart: start, selEnd: end + delta }
}

function insertLink(
  text: string,
  start: number,
  end: number,
  url?: string,
): { value: string; selStart: number; selEnd: number } {
  const selected = text.slice(start, end)
  const label = selected.trim() ? selected : 'link text'
  const href = url?.trim() ? url.trim() : 'https://'
  const wrapped = `[${label}](${href})`
  const insertion = text.slice(0, start) + wrapped + text.slice(end)
  const newStart = start + 1
  const newEnd = newStart + label.length
  return { value: insertion, selStart: newStart, selEnd: newEnd }
}
