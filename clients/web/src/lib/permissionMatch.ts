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
