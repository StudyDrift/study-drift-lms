/** Parse `#w=…&h=…` display size appended to image URLs in Markdown (TipTap round-trip). */
export function stripImageDisplayFragment(src: string): {
  base: string
  displayWidth?: number
  displayHeight?: number
} {
  const hash = src.indexOf('#')
  if (hash < 0) return { base: src }
  const base = src.slice(0, hash)
  const frag = src.slice(hash + 1)
  const wm = /(?:^|&)w=(\d+)/.exec(frag)
  const hm = /(?:^|&)h=(\d+)/.exec(frag)
  if (wm && hm) {
    return { base, displayWidth: parseInt(wm[1], 10), displayHeight: parseInt(hm[1], 10) }
  }
  return { base: src }
}

/** True when `src` (ignoring `#w=&h=` fragment) points at a course file blob that requires `Authorization`. */
export function needsAuthenticatedCourseImageSrc(src: string): boolean {
  const { base } = stripImageDisplayFragment(src)
  return base.includes('/course-files/') && base.endsWith('/content')
}

/** Path for `authorizedFetch` (path-only `/api/…`); strips display-size fragment. */
export function resolveAuthorizedFetchPath(src: string): string {
  const { base } = stripImageDisplayFragment(src)
  if (base.startsWith('/api/')) return base
  try {
    const u = new URL(base)
    if (u.pathname.startsWith('/api/')) return `${u.pathname}${u.search}`
    return base
  } catch {
    return base
  }
}
