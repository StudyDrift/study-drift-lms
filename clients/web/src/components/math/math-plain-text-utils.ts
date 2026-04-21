export type MathSegment =
  | { kind: 'text'; text: string }
  | { kind: 'inline'; latex: string }
  | { kind: 'display'; latex: string }

/**
 * Split plain text into alternating prose and `$...$` / `$$...$$` math regions.
 * Unclosed `$` is left as literal text.
 */
export function parseMathDelimitedText(input: string): MathSegment[] {
  const out: MathSegment[] = []
  let i = 0
  while (i < input.length) {
    if (input[i] === '$' && input[i + 1] === '$') {
      const close = input.indexOf('$$', i + 2)
      if (close === -1) {
        out.push({ kind: 'text', text: input.slice(i) })
        break
      }
      out.push({ kind: 'display', latex: input.slice(i + 2, close) })
      i = close + 2
      continue
    }
    if (input[i] === '$') {
      const close = input.indexOf('$', i + 1)
      if (close === -1) {
        out.push({ kind: 'text', text: input.slice(i) })
        break
      }
      out.push({ kind: 'inline', latex: input.slice(i + 1, close) })
      i = close + 1
      continue
    }
    const next = input.indexOf('$', i)
    if (next === -1) {
      out.push({ kind: 'text', text: input.slice(i) })
      break
    }
    out.push({ kind: 'text', text: input.slice(i, next) })
    i = next
  }
  return out
}
