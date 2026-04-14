type StudentLike = { id: string; name: string }

/** Sort rows by the Student column. */
export type StudentSortMode =
  | 'first_az'
  | 'first_za'
  | 'last_az'
  | 'last_za'
  | 'display_az'
  | 'display_za'

/** Sort rows by a single grade column. `late_first` matches `submitted_first` until submission status exists in the API. */
export type GradeColumnSortMode =
  | 'submitted_first'
  | 'late_first'
  | 'unsubmitted_first'
  | 'grade_az'
  | 'grade_za'

export type GradebookActiveSort =
  | { kind: 'student'; mode: StudentSortMode }
  | { kind: 'grade'; columnId: string; mode: GradeColumnSortMode }

function nameTokens(display: string): { first: string; last: string } {
  const parts = display.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { first: '', last: '' }
  if (parts.length === 1) return { first: parts[0]!, last: parts[0]! }
  return { first: parts[0]!, last: parts[parts.length - 1]! }
}

function cmpStr(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })
}

export function compareStudentsForSort(a: StudentLike, b: StudentLike, mode: StudentSortMode): number {
  const { first: fa, last: la } = nameTokens(a.name)
  const { first: fb, last: lb } = nameTokens(b.name)
  let primary = 0
  switch (mode) {
    case 'first_az':
      primary = cmpStr(fa, fb)
      break
    case 'first_za':
      primary = cmpStr(fb, fa)
      break
    case 'last_az':
      primary = cmpStr(la, lb)
      break
    case 'last_za':
      primary = cmpStr(lb, la)
      break
    case 'display_az':
      primary = cmpStr(a.name, b.name)
      break
    case 'display_za':
      primary = cmpStr(b.name, a.name)
      break
    default:
      break
  }
  if (primary !== 0) return primary
  return cmpStr(a.name, b.name)
}

function cellHasSubmission(grades: Record<string, Record<string, string>>, studentId: string, columnId: string): boolean {
  const raw = grades[studentId]?.[columnId]
  return raw != null && raw.trim() !== ''
}

/** For sorting: numeric score if parseable, else NaN. */
function gradeSortKey(grades: Record<string, Record<string, string>>, studentId: string, columnId: string): number {
  const raw = (grades[studentId]?.[columnId] ?? '').trim()
  if (!raw) return Number.NaN
  const n = Number.parseFloat(raw.replace(/,/g, ''))
  return Number.isFinite(n) ? n : Number.NaN
}

function cmpGradeValues(
  grades: Record<string, Record<string, string>>,
  aId: string,
  bId: string,
  columnId: string,
  asc: boolean,
): number {
  const na = gradeSortKey(grades, aId, columnId)
  const nb = gradeSortKey(grades, bId, columnId)
  const aEmpty = Number.isNaN(na)
  const bEmpty = Number.isNaN(nb)
  if (aEmpty && bEmpty) return 0
  if (aEmpty) return 1
  if (bEmpty) return -1
  const c = asc ? na - nb : nb - na
  if (c !== 0) return c
  return cmpStr(String(na), String(nb))
}

export function compareStudentsByGradeColumn(
  a: StudentLike,
  b: StudentLike,
  grades: Record<string, Record<string, string>>,
  columnId: string,
  mode: GradeColumnSortMode,
): number {
  const hasA = cellHasSubmission(grades, a.id, columnId)
  const hasB = cellHasSubmission(grades, b.id, columnId)

  switch (mode) {
    case 'submitted_first':
    case 'late_first': {
      if (hasA !== hasB) return hasA ? -1 : 1
      break
    }
    case 'unsubmitted_first': {
      if (hasA !== hasB) return hasA ? 1 : -1
      break
    }
    case 'grade_az':
      return cmpGradeValues(grades, a.id, b.id, columnId, true)
    case 'grade_za':
      return cmpGradeValues(grades, a.id, b.id, columnId, false)
    default:
      break
  }

  // submitted / late / unsubmitted groups: tiebreak by display name A→Z
  return compareStudentsForSort(a, b, 'display_az')
}
