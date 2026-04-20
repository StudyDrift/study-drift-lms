import { fetchModuleAssignment, fetchModuleContentPage } from './courses-api'

/** Serialized token in the prompt string (not shown verbatim in the UI — rendered as a chip). */
export const REF_TOKEN_RE =
  /<<REF:(assignment|content_page):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([A-Za-z0-9_-]*)>>/g

export function encodeTitleForToken(title: string): string {
  const bytes = new TextEncoder().encode(title)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  const b64 = btoa(bin)
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decodeTitleFromToken(b64url: string): string {
  if (!b64url) return ''
  const pad = b64url.length % 4 === 0 ? '' : '='.repeat(4 - (b64url.length % 4))
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + pad
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

export function encodeRefToken(
  kind: 'assignment' | 'content_page',
  id: string,
  title: string,
): string {
  return `<<REF:${kind}:${id}:${encodeTitleForToken(title)}>>`
}

/** In-app route for a tagged module content page or assignment (syllabus / editor links). */
export function hrefForModuleCourseItem(
  courseCode: string,
  kind: 'assignment' | 'content_page',
  itemId: string,
): string {
  const cc = encodeURIComponent(courseCode)
  const id = encodeURIComponent(itemId)
  if (kind === 'content_page') {
    return `/courses/${cc}/modules/content/${id}`
  }
  return `/courses/${cc}/modules/assignment/${id}`
}

function kindLabelForExpand(kind: 'assignment' | 'content_page'): string {
  return kind === 'content_page' ? 'CONTENT PAGE' : 'ASSIGNMENT'
}

/**
 * Replaces each ref token with fetched markdown wrapped in begin/end markers.
 */
export async function expandQuizPromptWithRefs(courseCode: string, prompt: string): Promise<string> {
  const re = new RegExp(REF_TOKEN_RE.source, 'g')
  const matches = Array.from(prompt.matchAll(re))
  if (matches.length === 0) return prompt

  let out = ''
  let last = 0
  for (const m of matches) {
    const idx = m.index ?? 0
    out += prompt.slice(last, idx)
    const kind = m[1] as 'assignment' | 'content_page'
    const id = m[2]
    const title = decodeTitleFromToken(m[3] ?? '')
    const label = kindLabelForExpand(kind)
    try {
      const payload =
        kind === 'content_page'
          ? await fetchModuleContentPage(courseCode, id)
          : await fetchModuleAssignment(courseCode, id)
      const md = payload.markdown.trim()
      const body = md.length > 0 ? md : '_(No body text.)_'
      out += `\n\n--- BEGIN CONTENT FROM ${label}: "${title}" ---\n`
      out += body
      out += `\n--- END CONTENT FROM ${label}: "${title}" ---\n\n`
    } catch {
      out += `\n\n--- (Could not load ${kind === 'content_page' ? 'content page' : 'assignment'}: "${title}") ---\n\n`
    }
    last = idx + m[0].length
  }
  out += prompt.slice(last)
  return out
}
