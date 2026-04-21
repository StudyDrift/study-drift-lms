const UNGROUPED = '__ungrouped__'

export type GradebookColumnForFinal = {
  id: string
  maxPoints: number | null
  assignmentGroupId?: string | null
}

export type AssignmentGroupWeight = {
  id: string
  weightPercent: number
}

function parseEarned(raw: string | undefined): number {
  const t = (raw ?? '').trim()
  if (!t) return 0
  const n = Number.parseFloat(t.replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

/**
 * Course final as a percentage (0–100) from assignment-group weights and per-item earned / max points.
 * Blank or non-numeric grade cells count as 0 earned. Items without positive max points are ignored.
 * Weight from configured groups that have no gradebook columns is shifted onto the ungrouped bucket
 * when present; otherwise weights are renormalized across groups that do have columns.
 */
export function computeCourseFinalPercent(
  columns: GradebookColumnForFinal[],
  gradesByItemId: Record<string, string>,
  assignmentGroups: AssignmentGroupWeight[],
): number | null {
  const settingsIds = new Set(assignmentGroups.map((g) => g.id))
  const maxByBucket = new Map<string, number>()
  const earnedByBucket = new Map<string, number>()

  for (const col of columns) {
    const max = col.maxPoints
    if (max == null || max <= 0) continue

    const gid = col.assignmentGroupId?.trim()
    const bucket = gid && settingsIds.has(gid) ? gid : UNGROUPED

    const earned = parseEarned(gradesByItemId[col.id])
    maxByBucket.set(bucket, (maxByBucket.get(bucket) ?? 0) + max)
    earnedByBucket.set(bucket, (earnedByBucket.get(bucket) ?? 0) + earned)
  }

  const totalMaxPoints = [...maxByBucket.values()].reduce((a, b) => a + b, 0)
  if (totalMaxPoints <= 0) return null

  const bucketsWithColumns = new Set(
    [...maxByBucket.entries()].filter(([, mx]) => mx > 0).map(([b]) => b),
  )
  if (bucketsWithColumns.size === 0) return null

  const configuredSum = assignmentGroups.reduce((acc, g) => {
    const w = Number.isFinite(g.weightPercent) && g.weightPercent > 0 ? g.weightPercent : 0
    return acc + w
  }, 0)
  const remainder = Math.max(0, 100 - configuredSum)

  let lostConfiguredWeight = 0
  for (const g of assignmentGroups) {
    const w = Number.isFinite(g.weightPercent) && g.weightPercent > 0 ? g.weightPercent : 0
    if (w <= 0) continue
    if (!bucketsWithColumns.has(g.id)) lostConfiguredWeight += w
  }

  const maxUngrouped = maxByBucket.get(UNGROUPED) ?? 0

  const rawWeight = new Map<string, number>()
  for (const g of assignmentGroups) {
    if (!bucketsWithColumns.has(g.id)) continue
    const w = Number.isFinite(g.weightPercent) && g.weightPercent > 0 ? g.weightPercent : 0
    if (w > 0) rawWeight.set(g.id, w)
  }

  if (bucketsWithColumns.has(UNGROUPED)) {
    let wU = remainder + lostConfiguredWeight
    if (wU <= 0 && maxUngrouped > 0 && totalMaxPoints > 0) {
      wU = (maxUngrouped / totalMaxPoints) * 100
    }
    rawWeight.set(UNGROUPED, (rawWeight.get(UNGROUPED) ?? 0) + wU)
  }

  const weightSum = [...rawWeight.values()].reduce((a, b) => a + b, 0)
  if (weightSum <= 0) {
    const earnedTotal = [...earnedByBucket.values()].reduce((a, b) => a + b, 0)
    return (earnedTotal / totalMaxPoints) * 100
  }

  let acc = 0
  for (const [bucket, rw] of rawWeight) {
    if (rw <= 0) continue
    const maxB = maxByBucket.get(bucket) ?? 0
    const earnedB = earnedByBucket.get(bucket) ?? 0
    const ratio = maxB > 0 ? earnedB / maxB : 0
    acc += ratio * (rw / weightSum)
  }

  return acc * 100
}

export function formatFinalPercent(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct)) return '—'
  const rounded = Math.round(pct * 10) / 10
  return `${rounded}%`
}
