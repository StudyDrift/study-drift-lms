export interface DocArticle {
  slug: string
  title: string
  date: string
  description: string
  author: string
  content: string
}

const rawModules = import.meta.glob('../docs/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

function parseFrontmatter(raw: string): { meta: Record<string, string>; content: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!match) return { meta: {}, content: raw }

  const meta: Record<string, string> = {}
  for (const line of match[1].split('\n')) {
    const colon = line.indexOf(':')
    if (colon === -1) continue
    const key = line.slice(0, colon).trim()
    const value = line.slice(colon + 1).trim().replace(/^["']|["']$/g, '')
    meta[key] = value
  }

  return { meta, content: match[2].trim() }
}

export const allArticles: DocArticle[] = Object.entries(rawModules)
  .map(([path, raw]) => {
    const slug = path.replace('../docs/', '').replace(/\.md$/, '')
    const { meta, content } = parseFrontmatter(raw)
    return {
      slug,
      title: meta.title ?? slug,
      date: meta.date ?? '',
      description: meta.description ?? '',
      author: meta.author ?? 'Lextures Team',
      content,
    }
  })
  .sort((a, b) => b.date.localeCompare(a.date))

export function getArticle(slug: string): DocArticle | undefined {
  return allArticles.find(p => p.slug === slug)
}

export function formatDate(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}
