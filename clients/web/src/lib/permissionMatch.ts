/** Same rules as the server: four `:`-separated segments; `*` matches any value in that segment. */

function segmentMatches(g: string, r: string): boolean {
  return g === '*' || r === '*' || g === r
}

export function permissionMatches(granted: string, required: string): boolean {
  const gParts = granted.trim().split(':')
  const rParts = required.trim().split(':')
  if (gParts.length !== 4 || rParts.length !== 4) return false
  for (let i = 0; i < 4; i++) {
    if (!segmentMatches(gParts[i], rParts[i])) return false
  }
  return true
}

export function anyGrantMatches(grants: readonly string[], required: string): boolean {
  return grants.some((g) => permissionMatches(g, required))
}

/**
 * True when some grant is scoped to this exact course code (second segment) and authorizes
 * `course:<courseCode>:item:create`. Wildcard course segments (`course:*:…`) do not count — used so
 * student-view permission lists cannot rely on broad `course:*:item:create` alone for structure UI.
 */
export function hasConcreteCourseItemCreatePermission(
  grants: readonly string[],
  courseCode: string,
): boolean {
  const required = `course:${courseCode}:item:create`
  return grants.some((g) => {
    const parts = g.trim().split(':')
    if (parts.length !== 4 || parts[0] !== 'course') return false
    if (parts[1] !== courseCode) return false
    return permissionMatches(g, required)
  })
}
