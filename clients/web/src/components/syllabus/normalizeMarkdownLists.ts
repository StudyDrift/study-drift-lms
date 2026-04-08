/**
 * CommonMark requires indentation for nested lists. Canvas / LMS exports often leave
 * bullets and sub-numbered lines at column 0, so the parser emits flat <ol>/<ul> siblings
 * or one long <ol> with every line as a top-level <li>.
 *
 * These normalizers run before remark-parse so nested structure matches author intent.
 */

/** After a top-level `1.` block, indent `-` / `*` lines at column 0 so they nest under item 1. */
function indentBulletsAfterOrderedOne(markdown: string): string {
  const lines = markdown.split('\n')
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (/^1\.\s/.test(line)) {
      out.push(line)
      i++
      while (i < lines.length && lines[i]!.trim() !== '') {
        out.push(lines[i]!)
        i++
      }
      while (i < lines.length && lines[i]!.trim() === '') {
        out.push(lines[i]!)
        i++
      }
      while (i < lines.length) {
        const L = lines[i]!
        if (L.trim() === '') {
          out.push(L)
          i++
          break
        }
        if (/^[-*]\s/.test(L) && !L.startsWith(' ')) {
          out.push(`    ${L}`)
          i++
          continue
        }
        break
      }
      continue
    }
    out.push(line)
    i++
  }
  return out.join('\n')
}

/**
 * After a top-level `2.` block, indent following `1. 2. 3.` lines at column 0 so they nest
 * under item 2 (otherwise GFM merges them into one flat <ol start="2">).
 */
function indentNestedOrderedAfterTwo(markdown: string): string {
  const lines = markdown.split('\n')
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (/^2\.\s/.test(line)) {
      out.push(line)
      i++
      while (i < lines.length && lines[i]!.trim() !== '') {
        out.push(lines[i]!)
        i++
      }
      while (i < lines.length && lines[i]!.trim() === '') {
        out.push(lines[i]!)
        i++
      }
      while (i < lines.length) {
        const L = lines[i]!
        if (L.trim() === '') {
          out.push(L)
          i++
          break
        }
        if (/^\d+\.\s/.test(L) && !L.startsWith(' ')) {
          out.push(`    ${L}`)
          i++
          continue
        }
        break
      }
      continue
    }
    out.push(line)
    i++
  }
  return out.join('\n')
}

export function normalizeMarkdownLists(markdown: string): string {
  return indentNestedOrderedAfterTwo(indentBulletsAfterOrderedOne(markdown))
}
