const UNGROUPED = '__ungrouped__'

export type GradebookColumnForFinal = {
  id: string
  maxPoints: number | null
  assignmentGroupId?: string | null
  neverDrop?: boolean
  replaceWithFinal?: boolean
}

export type AssignmentGroupWeight = {
  id: string
  weightPercent: number
  /** Plan 3.9 */
  dropLowest?: number
  dropHighest?: number
  replaceLowestWithFinal?: boolean
}

type GroupPolicy = { dropLowest: number; dropHighest: number; replaceLowestWithFinal: boolean }

type Scored = {
  id: string
  max: number
  earned: number
  pct: number
  canDrop: boolean
  isFinal: boolean
}

function parseEarned(raw: string | undefined): number {
  const t = (raw ?? '').trim()
  if (!t) return 0
  const n = Number.parseFloat(t.replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

/**
 * Port of `server::services::grading::assignment_groups::compute_group_average_with_drops` (plan 3.9).
 * Returns effective earned/max for one assignment group and one student.
 */
export function groupEffectiveEarnedAndMax(
  policy: GroupPolicy,
  lines: { itemId: string; max: number; earned: number; neverDrop: boolean; isFinal: boolean }[],
): { effectiveEarned: number; effectiveMax: number } {
  if (lines.length === 0) {
    return { effectiveEarned: 0, effectiveMax: 0 }
  }
  const rows: Scored[] = lines
    .map((l) => {
      const max = l.max > 0 && Number.isFinite(l.max) ? l.max : 0
      const earned = Math.max(0, l.earned)
      const pct = max > 0 ? earned / max : 0
      const isFinal = l.isFinal
      const canDrop = !l.neverDrop && !isFinal
      return {
        id: l.itemId,
        max,
        earned,
        pct: Number.isFinite(pct) ? pct : 0,
        canDrop,
        isFinal,
      }
    })
    .filter((r) => r.max > 0)

  rows.sort((a, b) => (a.pct !== b.pct ? a.pct - b.pct : a.id.localeCompare(b.id)))
  const work: Scored[] = rows.filter((r) => r.canDrop)
  const dropped = new Set<string>()

  const nLow = Math.max(0, policy.dropLowest)
  const nHigh = Math.max(0, policy.dropHighest)
  for (let i = 0; i < nLow; i++) {
    if (work.length === 0) break
    dropped.add(work.shift()!.id)
  }
  for (let i = 0; i < nHigh; i++) {
    if (work.length === 0) break
    dropped.add(work.pop()!.id)
  }

  let effectiveMax = 0
  let effectiveEarned = 0
  for (const r of rows) {
    if (dropped.has(r.id)) continue
    effectiveMax += r.max
    effectiveEarned += r.earned
  }

  if (policy.replaceLowestWithFinal) {
    const f = rows.find((r) => r.isFinal && !dropped.has(r.id))
    if (f && f.pct > 0) {
      const others = rows.filter((r) => !r.isFinal && !dropped.has(r.id))
      if (others.length > 0) {
        let t = others[0]!
        for (const r of others) {
          if (r.pct < t.pct) t = r
          else if (r.pct === t.pct && r.id < t.id) t = r
        }
        if (f.pct > t.pct + 1e-12) {
          effectiveEarned -= t.earned
          effectiveEarned += t.max * f.pct
        }
      }
    }
  }
  return { effectiveEarned, effectiveMax }
}

/**
 * Course final as a percentage (0–100) with assignment-group drop / replace policy (3.9).
 * Ungrouped columns are summed without drops.
 */
export function computeCourseFinalPercent(
  columns: GradebookColumnForFinal[],
  gradesByItemId: Record<string, string>,
  assignmentGroups: AssignmentGroupWeight[],
): number | null {
  const settingsIds = new Set(assignmentGroups.map((g) => g.id))
  const polByG = new Map<string, GroupPolicy>()
  for (const g of assignmentGroups) {
    polByG.set(g.id, {
      dropLowest: g.dropLowest != null && g.dropLowest > 0 ? g.dropLowest : 0,
      dropHighest: g.dropHighest != null && g.dropHighest > 0 ? g.dropHighest : 0,
      replaceLowestWithFinal: g.replaceLowestWithFinal === true,
    })
  }

  const maxByBucket = new Map<string, number>()
  const earnedByBucket = new Map<string, number>()

  const byGroup: Map<string, { itemId: string; max: number; earned: number; neverDrop: boolean; isFinal: boolean }[]> =
    new Map()

  for (const col of columns) {
    const max = col.maxPoints
    if (max == null || max <= 0) continue
    const earned = parseEarned(gradesByItemId[col.id])
    const gid = col.assignmentGroupId?.trim()
    const bucket = gid && settingsIds.has(gid) ? gid : UNGROUPED
    const isFinal = col.replaceWithFinal === true
    const neverDrop = col.neverDrop === true

    if (bucket === UNGROUPED) {
      maxByBucket.set(bucket, (maxByBucket.get(bucket) ?? 0) + max)
      earnedByBucket.set(bucket, (earnedByBucket.get(bucket) ?? 0) + earned)
    } else {
      if (!byGroup.has(bucket)) byGroup.set(bucket, [])
      byGroup.get(bucket)!.push({
        itemId: col.id,
        max,
        earned,
        neverDrop,
        isFinal,
      })
    }
  }

  for (const [gid, lines] of byGroup) {
    const p = polByG.get(gid) ?? { dropLowest: 0, dropHighest: 0, replaceLowestWithFinal: false }
    const { effectiveEarned, effectiveMax } = groupEffectiveEarnedAndMax(p, lines)
    maxByBucket.set(gid, (maxByBucket.get(gid) ?? 0) + effectiveMax)
    earnedByBucket.set(gid, (earnedByBucket.get(gid) ?? 0) + effectiveEarned)
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
