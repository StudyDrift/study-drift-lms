/** True when `src` points at a course file blob that requires `Authorization` to fetch. */
export function needsAuthenticatedCourseImageSrc(src: string): boolean {
  return src.includes('/course-files/') && src.endsWith('/content')
}

/** Path for `authorizedFetch` (path-only `/api/...` preferred). */
export function resolveAuthorizedFetchPath(src: string): string {
  if (src.startsWith('/api/')) return src
  try {
    const u = new URL(src)
    if (u.pathname.startsWith('/api/')) return `${u.pathname}${u.search}`
    return src
  } catch {
    return src
  }
}
