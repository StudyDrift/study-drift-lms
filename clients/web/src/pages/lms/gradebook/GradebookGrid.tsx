import {
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import {
  type GradebookActiveSort,
  type GradeColumnSortMode,
  type StudentSortMode,
  compareStudentsByGradeColumn,
  compareStudentsForSort,
} from './gradebookSort'
import {
  computeCourseFinalPercent,
  formatFinalPercent,
  type AssignmentGroupWeight,
} from './computeCourseFinalPercent'
import type { RubricDefinition } from '../../../lib/coursesApi'

export type GradebookColumn = {
  id: string
  title: string
  maxPoints: number | null
  assignmentGroupId?: string | null
  rubric?: RubricDefinition | null
}

export type GradebookStudent = {
  id: string
  name: string
}

type GradebookGridProps = {
  columns: GradebookColumn[]
  students: GradebookStudent[]
  initialGrades: Record<string, Record<string, string>>
  /** Weights from course grading settings; empty uses straight points across the grid. */
  assignmentGroups?: AssignmentGroupWeight[]
  footerNote?: string
  /** When true, scores cannot be edited (view-only). */
  readOnly?: boolean
  /** Called whenever the in-memory grade map changes (for save/discard UI). */
  onGradesChange?: (grades: Record<string, Record<string, string>>) => void
  /** Open rubric scoring for a student/column (assignment columns with a rubric). */
  onRubricClick?: (studentId: string, columnId: string) => void
}

const CELL_PAD = 'px-3 py-2 text-sm'
/** Sticky student column width; “Final” uses the same value for `left`. */
const STICKY_NAME_WIDTH_CLASS = 'w-[12rem] min-w-[12rem] max-w-[12rem]'

type HeaderMenuState =
  | null
  | { kind: 'student'; top: number; left: number; minWidth: number }
  | { kind: 'column'; columnId: string; top: number; left: number; minWidth: number }

function HeaderSortMenuPortal({
  menu,
  onClose,
  children,
}: {
  menu: Exclude<HeaderMenuState, null>
  onClose: () => void
  children: ReactNode
}) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (!(e.target instanceof Node)) return
      if (panelRef.current?.contains(e.target)) return
      onClose()
    }
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDocMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  useEffect(() => {
    function onScroll() {
      onClose()
    }
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={panelRef}
      role="menu"
      className="fixed z-[200] min-w-[14rem] rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-neutral-600 dark:bg-neutral-900"
      style={{ top: menu.top, left: menu.left, minWidth: menu.minWidth }}
    >
      {children}
    </div>,
    document.body,
  )
}

function menuButtonClass(active: boolean) {
  return [
    'inline-flex w-full max-w-full items-center justify-between gap-1 rounded-md px-1 py-0.5 text-left font-[inherit] transition',
    active
      ? 'bg-indigo-100 text-indigo-950 ring-1 ring-indigo-300 dark:bg-indigo-950/80 dark:text-indigo-100 dark:ring-indigo-600'
      : 'text-inherit hover:bg-slate-200/80 dark:hover:bg-neutral-700/80',
  ].join(' ')
}

function menuItemClass() {
  return 'block w-full px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-100 dark:text-neutral-100 dark:hover:bg-neutral-800'
}

function normalizeFilter(s: string): string {
  return s.trim().toLowerCase()
}

type SelectionBounds = { row0: number; row1: number; col0: number; col1: number }

type FillDragState = { src: SelectionBounds; destRow1: number; destCol1: number }

function pickGradebookCellFromPoint(clientX: number, clientY: number): { row: number; col: number } | null {
  for (const el of document.elementsFromPoint(clientX, clientY)) {
    if (!(el instanceof HTMLElement)) continue
    const cell = el.closest<HTMLElement>('[data-gradebook-cell="1"]')
    if (!cell || cell.dataset.gradebookRow == null) continue
    const row = Number.parseInt(cell.dataset.gradebookRow, 10)
    const col = Number.parseInt(cell.dataset.gradebookCol ?? '', 10)
    if (Number.isFinite(row) && Number.isFinite(col)) return { row, col }
  }
  return null
}

export function GradebookGrid({
  columns,
  students,
  initialGrades,
  assignmentGroups = [],
  footerNote,
  readOnly = false,
  onGradesChange,
  onRubricClick,
}: GradebookGridProps) {
  const [grades, setGrades] = useState<Record<string, Record<string, string>>>(() =>
    structuredClone(initialGrades),
  )
  const [activeSort, setActiveSort] = useState<GradebookActiveSort | null>(null)
  const [headerMenu, setHeaderMenu] = useState<HeaderMenuState>(null)
  const [studentFilter, setStudentFilter] = useState('')
  const [assignmentFilter, setAssignmentFilter] = useState('')
  const [focusRow, setFocusRow] = useState(0)
  const [focusCol, setFocusCol] = useState(0)
  /** Fixed corner for Shift+arrows / Shift+click / drag rectangle selection; `null` for a plain single-cell focus. */
  const [selectionAnchor, setSelectionAnchor] = useState<{ row: number; col: number } | null>(null)
  const [editing, setEditing] = useState<{
    rowMin: number
    rowMax: number
    colMin: number
    colMax: number
  } | null>(null)
  const [draft, setDraft] = useState('')

  const focusStudentIdRef = useRef<string | null>(null)
  const focusRowRef = useRef(0)
  focusRowRef.current = focusRow

  const editInputRef = useRef<HTMLInputElement>(null)
  /** When true, the next input `blur` must not commit (Escape cancels). */
  const skipCommitOnBlurRef = useRef(false)
  /** Pointer-drag selection: mousedown cell; used when pointer enters another cell while button held. */
  const dragSelectStartRef = useRef<{ row: number; col: number } | null>(null)
  const dragDidMoveRef = useRef(false)

  /** Excel-style fill handle: drag from selection corner to tile-copy values into a larger rectangle. */
  const [fillDrag, setFillDrag] = useState<FillDragState | null>(null)
  const fillDragRef = useRef<FillDragState | null>(null)
  /** After a fill drag, ignore the synthetic click on the cell under the pointer so selection stays correct. */
  const skipNextCellClickRef = useRef(false)

  const baseRowCount = students.length
  const baseColCount = columns.length

  const sortedStudents = useMemo(() => {
    if (!activeSort) return students
    const copy = [...students]
    if (activeSort.kind === 'student') {
      copy.sort((a, b) => compareStudentsForSort(a, b, activeSort.mode) || a.id.localeCompare(b.id))
      return copy
    }
    copy.sort(
      (a, b) =>
        compareStudentsByGradeColumn(a, b, grades, activeSort.columnId, activeSort.mode) ||
        a.id.localeCompare(b.id),
    )
    return copy
  }, [students, activeSort, grades])

  const studentFilterNorm = normalizeFilter(studentFilter)
  const assignmentFilterNorm = normalizeFilter(assignmentFilter)

  const visibleColumns = useMemo(() => {
    if (!assignmentFilterNorm) return columns
    return columns.filter((c) => c.title.toLowerCase().includes(assignmentFilterNorm))
  }, [columns, assignmentFilterNorm])

  const filteredStudents = useMemo(() => {
    if (!studentFilterNorm) return sortedStudents
    return sortedStudents.filter((s) => s.name.toLowerCase().includes(studentFilterNorm))
  }, [sortedStudents, studentFilterNorm])

  const rowCount = filteredStudents.length
  const colCount = visibleColumns.length
  const totalCells = rowCount * colCount

  const gradesRef = useRef(grades)
  gradesRef.current = grades
  const filteredStudentsRef = useRef(filteredStudents)
  filteredStudentsRef.current = filteredStudents
  const visibleColumnsRef = useRef(visibleColumns)
  visibleColumnsRef.current = visibleColumns

  const columnsForFinal = useMemo(
    () =>
      columns.map((c) => ({
        id: c.id,
        maxPoints: c.maxPoints,
        assignmentGroupId: c.assignmentGroupId ?? null,
      })),
    [columns],
  )

  const finalPercentByStudentId = useMemo(() => {
    const out: Record<string, number | null> = {}
    for (const s of students) {
      out[s.id] = computeCourseFinalPercent(columnsForFinal, grades[s.id] ?? {}, assignmentGroups)
    }
    return out
  }, [students, columnsForFinal, grades, assignmentGroups])

  const cellRefs = useRef<(HTMLTableCellElement | null)[][]>([])

  useEffect(() => {
    setGrades(structuredClone(initialGrades))
    setActiveSort(null)
    setHeaderMenu(null)
    setStudentFilter('')
    setAssignmentFilter('')
    setFocusRow(0)
    setFocusCol(0)
    setSelectionAnchor(null)
    setEditing(null)
    setDraft('')
    fillDragRef.current = null
    setFillDrag(null)
    focusStudentIdRef.current = students[0]?.id ?? null
  }, [initialGrades, students, columns])

  useEffect(() => {
    onGradesChange?.(grades)
  }, [grades, onGradesChange])

  useEffect(() => {
    if (activeSort?.kind !== 'grade') return
    if (!columns.some((c) => c.id === activeSort.columnId)) {
      setActiveSort(null)
      return
    }
    if (!visibleColumns.some((c) => c.id === activeSort.columnId)) {
      setActiveSort(null)
    }
  }, [activeSort, columns, visibleColumns])

  useEffect(() => {
    const s = filteredStudents[focusRow]
    if (s) focusStudentIdRef.current = s.id
  }, [focusRow, filteredStudents])

  useLayoutEffect(() => {
    if (filteredStudents.length === 0) return
    let id = focusStudentIdRef.current
    if (id == null) {
      id = filteredStudents[0]!.id
      focusStudentIdRef.current = id
      setFocusRow(0)
      return
    }
    const idx = filteredStudents.findIndex((s) => s.id === id)
    if (idx === -1) {
      setFocusRow(0)
      focusStudentIdRef.current = filteredStudents[0]!.id
      return
    }
    if (idx !== focusRowRef.current) setFocusRow(idx)
  }, [filteredStudents])

  useEffect(() => {
    if (rowCount > 0 && focusRow >= rowCount) setFocusRow(rowCount - 1)
  }, [focusRow, rowCount])

  useEffect(() => {
    if (colCount > 0 && focusCol >= colCount) setFocusCol(colCount - 1)
  }, [focusCol, colCount])

  useEffect(() => {
    cellRefs.current = filteredStudents.map(() => visibleColumns.map(() => null))
  }, [filteredStudents, visibleColumns])

  const setCellRef = useCallback(
    (row: number, col: number, el: HTMLTableCellElement | null) => {
      if (!cellRefs.current[row]) {
        cellRefs.current[row] = new Array(visibleColumns.length).fill(null)
      }
      cellRefs.current[row][col] = el
    },
    [visibleColumns.length],
  )

  const focusCell = useCallback(
    (row: number, col: number, opts?: { clearSelectionAnchor?: boolean }) => {
      if (rowCount === 0 || colCount === 0) return
      const r = Math.max(0, Math.min(rowCount - 1, row))
      const c = Math.max(0, Math.min(colCount - 1, col))
      setFocusRow(r)
      setFocusCol(c)
      if (opts?.clearSelectionAnchor !== false) {
        setSelectionAnchor(null)
      }
      const sid = filteredStudents[r]?.id
      if (sid) focusStudentIdRef.current = sid
    },
    [rowCount, colCount, filteredStudents],
  )

  useEffect(() => {
    if (!editing && rowCount > 0 && colCount > 0) {
      cellRefs.current[focusRow]?.[focusCol]?.focus()
    }
  }, [focusRow, focusCol, editing, rowCount, colCount])

  const openHeaderMenu = useCallback(
    (next: { kind: 'student' } | { kind: 'column'; columnId: string }, anchorEl: HTMLElement | null) => {
      if (!anchorEl) return
      const r = anchorEl.getBoundingClientRect()
      const base = { top: r.bottom + 6, left: r.left, minWidth: Math.max(200, r.width) }
      if (next.kind === 'student') {
        setHeaderMenu({ kind: 'student', ...base })
      } else {
        setHeaderMenu({ kind: 'column', columnId: next.columnId, ...base })
      }
    },
    [],
  )

  const displayValue = useCallback(
    (row: number, col: number) => {
      const sid = filteredStudents[row]!.id
      const aid = visibleColumns[col]!.id
      return grades[sid]?.[aid] ?? ''
    },
    [grades, filteredStudents, visibleColumns],
  )

  const beginEdit = useCallback(
    (row: number, col: number, opts?: { range?: 'selection' | 'single' }) => {
      if (readOnly) return
      const rangeMode = opts?.range ?? 'selection'
      let rowMin = row
      let rowMax = row
      let colMin = col
      let colMax = col
      if (rangeMode === 'selection' && selectionAnchor != null) {
        rowMin = Math.min(selectionAnchor.row, focusRow)
        rowMax = Math.max(selectionAnchor.row, focusRow)
        colMin = Math.min(selectionAnchor.col, focusCol)
        colMax = Math.max(selectionAnchor.col, focusCol)
      }
      setDraft(displayValue(row, col))
      setEditing({ rowMin, rowMax, colMin, colMax })
    },
    [displayValue, selectionAnchor, focusRow, focusCol, readOnly],
  )

  const commitEdit = useCallback(() => {
    if (!editing) return
    const { rowMin, rowMax, colMin, colMax } = editing
    const r0 = Math.min(rowMin, rowMax)
    const r1 = Math.max(rowMin, rowMax)
    const c0 = Math.min(colMin, colMax)
    const c1 = Math.max(colMin, colMax)
    const trimmed = draft.trim()
    setGrades((prev) => {
      const next = { ...prev }
      for (let r = r0; r <= r1; r++) {
        const sid = filteredStudents[r]!.id
        const rowEntry = { ...(next[sid] ?? {}) }
        for (let c = c0; c <= c1; c++) {
          const aid = visibleColumns[c]!.id
          rowEntry[aid] = trimmed
        }
        next[sid] = rowEntry
      }
      return next
    })
    setEditing(null)
    setSelectionAnchor(null)
  }, [editing, draft, filteredStudents, visibleColumns])

  const cancelEdit = useCallback(() => {
    skipCommitOnBlurRef.current = true
    setEditing(null)
    setSelectionAnchor(null)
  }, [])

  useLayoutEffect(() => {
    if (!editing) return
    const el = editInputRef.current
    if (!el) return
    el.focus()
    const len = el.value.length
    el.setSelectionRange(len, len)
  }, [editing])

  const moveBy = useCallback(
    (deltaRow: number, deltaCol: number, opts?: { clearSelectionAnchor?: boolean }) => {
      focusCell(focusRow + deltaRow, focusCol + deltaCol, opts)
    },
    [focusCell, focusRow, focusCol],
  )

  const moveToIndex = useCallback(
    (idx: number) => {
      if (totalCells === 0) return
      const i = ((idx % totalCells) + totalCells) % totalCells
      const r = Math.floor(i / colCount)
      const c = i % colCount
      focusCell(r, c)
    },
    [totalCells, colCount, focusCell],
  )

  const clearSelectedScores = useCallback(() => {
    if (readOnly) return
    const r0 = selectionAnchor == null ? focusRow : Math.min(selectionAnchor.row, focusRow)
    const r1 = selectionAnchor == null ? focusRow : Math.max(selectionAnchor.row, focusRow)
    const c0 = selectionAnchor == null ? focusCol : Math.min(selectionAnchor.col, focusCol)
    const c1 = selectionAnchor == null ? focusCol : Math.max(selectionAnchor.col, focusCol)
    setGrades((prev) => {
      const next = { ...prev }
      for (let r = r0; r <= r1; r++) {
        const sid = filteredStudents[r]!.id
        const rowEntry = { ...(next[sid] ?? {}) }
        for (let c = c0; c <= c1; c++) {
          const aid = visibleColumns[c]!.id
          rowEntry[aid] = ''
        }
        next[sid] = rowEntry
      }
      return next
    })
  }, [readOnly, selectionAnchor, focusRow, focusCol, filteredStudents, visibleColumns])

  const handleFillKnobPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>, src: SelectionBounds) => {
      if (readOnly) return
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      if (editing || rowCount === 0 || colCount === 0) return

      const initial: FillDragState = {
        src: { ...src },
        destRow1: src.row1,
        destCol1: src.col1,
      }
      fillDragRef.current = initial
      setFillDrag(initial)

      const onMove = (ev: PointerEvent) => {
        const cur = fillDragRef.current
        if (!cur) return
        const hit = pickGradebookCellFromPoint(ev.clientX, ev.clientY)
        const next =
          hit != null &&
          hit.row >= cur.src.row0 &&
          hit.row < rowCount &&
          hit.col >= cur.src.col0 &&
          hit.col < colCount
            ? {
                ...cur,
                destRow1: Math.max(cur.src.row1, hit.row),
                destCol1: Math.max(cur.src.col1, hit.col),
              }
            : cur
        if (next.destRow1 !== cur.destRow1 || next.destCol1 !== cur.destCol1) {
          fillDragRef.current = next
          setFillDrag(next)
        }
      }

      const onUp = () => {
        window.removeEventListener('pointermove', onMove, true)
        window.removeEventListener('pointerup', onUp, true)
        window.removeEventListener('pointercancel', onUp, true)

        const fd = fillDragRef.current
        fillDragRef.current = null
        setFillDrag(null)
        if (!fd) return

        const { src: s, destRow1, destCol1 } = fd
        if (destRow1 === s.row1 && destCol1 === s.col1) return

        skipNextCellClickRef.current = true

        const srcH = s.row1 - s.row0 + 1
        const srcW = s.col1 - s.col0 + 1
        const fs = filteredStudentsRef.current
        const vc = visibleColumnsRef.current

        setGrades((prev) => {
          const next: Record<string, Record<string, string>> = { ...prev }
          for (let r = s.row0; r <= destRow1; r++) {
            const sid = fs[r]!.id
            const rowEntry = { ...(next[sid] ?? {}) }
            for (let c = s.col0; c <= destCol1; c++) {
              const srcR = s.row0 + ((r - s.row0) % srcH)
              const srcC = s.col0 + ((c - s.col0) % srcW)
              const srcSid = fs[srcR]!.id
              const srcAid = vc[srcC]!.id
              const aid = vc[c]!.id
              rowEntry[aid] = prev[srcSid]?.[srcAid] ?? ''
            }
            next[sid] = rowEntry
          }
          return next
        })

        setSelectionAnchor({ row: s.row0, col: s.col0 })
        setFocusRow(destRow1)
        setFocusCol(destCol1)
        const sid = fs[destRow1]?.id
        if (sid) focusStudentIdRef.current = sid
      }

      window.addEventListener('pointermove', onMove, { capture: true })
      window.addEventListener('pointerup', onUp, { capture: true })
      window.addEventListener('pointercancel', onUp, { capture: true })
    },
    [colCount, editing, readOnly, rowCount],
  )

  const handleGradeCellKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTableCellElement>, row: number, col: number) => {
      if (editing) return
      if (row !== focusRow || col !== focusCol) return

      if (
        readOnly &&
        (e.key === 'Enter' || e.key === 'F2' || e.key === 'Delete' || e.key === 'Backspace')
      ) {
        e.preventDefault()
        return
      }

      const idx = row * colCount + col

      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault()
          if (e.shiftKey) {
            setSelectionAnchor((a) => a ?? { row: focusRow, col: focusCol })
            moveBy(-1, 0, { clearSelectionAnchor: false })
          } else {
            setSelectionAnchor(null)
            moveBy(-1, 0)
          }
          break
        case 'ArrowDown':
          e.preventDefault()
          if (e.shiftKey) {
            setSelectionAnchor((a) => a ?? { row: focusRow, col: focusCol })
            moveBy(1, 0, { clearSelectionAnchor: false })
          } else {
            setSelectionAnchor(null)
            moveBy(1, 0)
          }
          break
        case 'ArrowLeft':
          e.preventDefault()
          if (e.shiftKey) {
            setSelectionAnchor((a) => a ?? { row: focusRow, col: focusCol })
            moveBy(0, -1, { clearSelectionAnchor: false })
          } else {
            setSelectionAnchor(null)
            moveBy(0, -1)
          }
          break
        case 'ArrowRight':
          e.preventDefault()
          if (e.shiftKey) {
            setSelectionAnchor((a) => a ?? { row: focusRow, col: focusCol })
            moveBy(0, 1, { clearSelectionAnchor: false })
          } else {
            setSelectionAnchor(null)
            moveBy(0, 1)
          }
          break
        case 'Enter':
        case 'F2':
          e.preventDefault()
          beginEdit(row, col)
          break
        case 'Delete':
        case 'Backspace':
          e.preventDefault()
          clearSelectedScores()
          break
        case 'Escape':
          if (selectionAnchor != null) {
            e.preventDefault()
            setSelectionAnchor(null)
          }
          break
        case 'Tab': {
          e.preventDefault()
          if (e.shiftKey) {
            moveToIndex(idx - 1)
          } else {
            moveToIndex(idx + 1)
          }
          break
        }
        default:
          break
      }
    },
    [
      readOnly,
      editing,
      focusRow,
      focusCol,
      colCount,
      selectionAnchor,
      moveBy,
      moveToIndex,
      beginEdit,
      clearSelectedScores,
    ],
  )

  const handleEditInputBlur = useCallback(() => {
    if (skipCommitOnBlurRef.current) {
      skipCommitOnBlurRef.current = false
      return
    }
    commitEdit()
  }, [commitEdit])

  const handleInputKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        commitEdit()
        moveBy(1, 0)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        cancelEdit()
      } else if (e.key === 'Tab') {
        e.preventDefault()
        if (!editing) return
        const idx = focusRow * colCount + focusCol
        commitEdit()
        moveToIndex(e.shiftKey ? idx - 1 : idx + 1)
      }
    },
    [commitEdit, cancelEdit, moveBy, moveToIndex, colCount, editing, focusRow],
  )

  const selectionRect = useMemo(() => {
    if (editing) {
      const row0 = Math.min(editing.rowMin, editing.rowMax)
      const row1 = Math.max(editing.rowMin, editing.rowMax)
      const col0 = Math.min(editing.colMin, editing.colMax)
      const col1 = Math.max(editing.colMin, editing.colMax)
      return { row0, row1, col0, col1 } as const
    }
    if (selectionAnchor != null) {
      const row0 = Math.min(selectionAnchor.row, focusRow)
      const row1 = Math.max(selectionAnchor.row, focusRow)
      const col0 = Math.min(selectionAnchor.col, focusCol)
      const col1 = Math.max(selectionAnchor.col, focusCol)
      return { row0, row1, col0, col1 } as const
    }
    return null
  }, [editing, selectionAnchor, focusRow, focusCol])

  /** Selection used for fill handle: explicit range, or the focused grade cell when there is no anchor. */
  const activeSelectionBounds = useMemo((): SelectionBounds | null => {
    if (editing) return null
    if (colCount === 0 || rowCount === 0) return null
    if (selectionRect != null) return selectionRect
    return { row0: focusRow, row1: focusRow, col0: focusCol, col1: focusCol }
  }, [editing, selectionRect, focusRow, focusCol, colCount, rowCount])

  const closeHeaderMenu = useCallback(() => setHeaderMenu(null), [])

  const pickStudentSort = useCallback((mode: StudentSortMode) => {
    setActiveSort({ kind: 'student', mode })
    setHeaderMenu(null)
  }, [])

  const pickGradeSort = useCallback((columnId: string, mode: GradeColumnSortMode) => {
    setActiveSort({ kind: 'grade', columnId, mode })
    setHeaderMenu(null)
  }, [])

  const clearSort = useCallback(() => {
    setActiveSort(null)
    setHeaderMenu(null)
  }, [])

  const studentHeaderActive = activeSort?.kind === 'student'

  const filterInputClass =
    'w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none placeholder:text-slate-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-neutral-600 dark:bg-neutral-950 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:border-indigo-400 dark:focus:ring-indigo-400'

  const hasFilters = studentFilterNorm.length > 0 || assignmentFilterNorm.length > 0

  const clearFilters = useCallback(() => {
    setStudentFilter('')
    setAssignmentFilter('')
  }, [])

  if (baseRowCount === 0 && baseColCount === 0) {
    return (
      <p className="mt-6 text-sm text-slate-600 dark:text-neutral-400">
        No student enrollments and no assignments or quizzes in this course yet.
      </p>
    )
  }

  if (baseRowCount === 0) {
    return (
      <div className="mt-6 space-y-3">
        <p className="text-sm text-slate-600 dark:text-neutral-400">
          No learners are enrolled as students in this course, so there are no rows to show.
        </p>
        {baseColCount > 0 && (
          <p className="text-xs text-slate-500 dark:text-neutral-500">
            {columns.length} assignment or quiz column{columns.length === 1 ? '' : 's'} will appear here once
            students are enrolled.
          </p>
        )}
      </div>
    )
  }

  if (baseColCount === 0) {
    return (
      <div className="mt-6 space-y-3">
        <p className="text-sm text-slate-600 dark:text-neutral-400">
          This course has no assignments or quizzes yet, or they are archived. Add module assignments or quizzes
          to see gradebook columns.
        </p>
      </div>
    )
  }

  return (
    <div className="mt-6 space-y-3">
      <div className="flex flex-wrap items-end gap-4 rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-900/50">
        <label className="flex min-w-[10rem] flex-1 flex-col gap-1">
          <span className="text-xs font-medium text-slate-600 dark:text-neutral-400">Student</span>
          <input
            type="search"
            className={filterInputClass}
            value={studentFilter}
            onChange={(e) => setStudentFilter(e.target.value)}
            placeholder="Search by student name…"
            aria-label="Filter students by name"
            autoComplete="off"
          />
        </label>
        <label className="flex min-w-[10rem] flex-1 flex-col gap-1">
          <span className="text-xs font-medium text-slate-600 dark:text-neutral-400">Assignment</span>
          <input
            type="search"
            className={filterInputClass}
            value={assignmentFilter}
            onChange={(e) => setAssignmentFilter(e.target.value)}
            placeholder="Search by assignment or quiz…"
            aria-label="Filter columns by assignment or quiz title"
            autoComplete="off"
          />
        </label>
        {hasFilters && (
          <button
            type="button"
            className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700/80"
            onClick={clearFilters}
          >
            Clear filters
          </button>
        )}
      </div>

      {rowCount === 0 && (
        <p className="text-sm text-slate-600 dark:text-neutral-400">
          No students match &quot;{studentFilter.trim() || '…'}&quot;. Try a different search or clear filters.
        </p>
      )}

      {rowCount > 0 && colCount === 0 && (
        <p className="text-sm text-slate-600 dark:text-neutral-400">
          No assignments or quizzes match &quot;{assignmentFilter.trim() || '…'}&quot;. Try a different search or
          clear filters.
        </p>
      )}

      {rowCount > 0 && baseColCount > 0 && (
      <div className="overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
        <table
          role="grid"
          aria-label="Grades by student and assignment"
          aria-rowcount={rowCount + 1}
          aria-colcount={2 + colCount}
          className="w-full min-w-max border-collapse text-left"
        >
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 dark:border-neutral-700 dark:bg-neutral-800">
              <th
                scope="col"
                className={`sticky top-0 left-0 z-30 ${STICKY_NAME_WIDTH_CLASS} ${CELL_PAD} border-b border-r border-slate-200 bg-slate-50 align-bottom dark:border-neutral-700 dark:bg-neutral-800`}
              >
                <button
                  type="button"
                  className={menuButtonClass(studentHeaderActive)}
                  aria-expanded={headerMenu?.kind === 'student'}
                  aria-haspopup="menu"
                  onClick={(e) => {
                    e.preventDefault()
                    if (headerMenu?.kind === 'student') {
                      setHeaderMenu(null)
                      return
                    }
                    openHeaderMenu({ kind: 'student' }, e.currentTarget)
                  }}
                >
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-neutral-400">
                    Student
                  </span>
                  <ChevronDown className="size-3.5 shrink-0 opacity-70" aria-hidden />
                </button>
              </th>
              <th
                scope="col"
                className={`sticky top-0 left-[12rem] z-25 min-w-[5.5rem] ${CELL_PAD} border-b border-r border-slate-200 bg-slate-50 align-bottom dark:border-neutral-700 dark:bg-neutral-800`}
              >
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-neutral-400">
                  Final
                </span>
              </th>
              {visibleColumns.map((col) => {
                const colActive = activeSort?.kind === 'grade' && activeSort.columnId === col.id
                return (
                  <th
                    key={col.id}
                    scope="col"
                    className={`sticky top-0 z-20 ${CELL_PAD} min-w-[9rem] border-b border-slate-200 bg-slate-50 align-bottom dark:border-neutral-700 dark:bg-neutral-800`}
                  >
                    <button
                      type="button"
                      className={`${menuButtonClass(colActive)} max-w-full`}
                      aria-expanded={headerMenu?.kind === 'column' && headerMenu.columnId === col.id}
                      aria-haspopup="menu"
                      onClick={(e) => {
                        e.preventDefault()
                        if (headerMenu?.kind === 'column' && headerMenu.columnId === col.id) {
                          setHeaderMenu(null)
                          return
                        }
                        openHeaderMenu({ kind: 'column', columnId: col.id }, e.currentTarget)
                      }}
                    >
                      <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left">
                        <span className="text-xs font-semibold text-slate-800 dark:text-neutral-200">{col.title}</span>
                        <span className="text-[0.65rem] font-normal text-slate-500 dark:text-neutral-400">
                          {col.maxPoints != null ? `Out of ${col.maxPoints}` : 'Max points not set'}
                        </span>
                      </span>
                      <ChevronDown className="size-3.5 shrink-0 self-start opacity-70" aria-hidden />
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {filteredStudents.map((student, row) => (
              <tr
                key={student.id}
                className="border-b border-slate-100 last:border-b-0 dark:border-neutral-700/80"
              >
                <th
                  scope="row"
                  title={student.name}
                  className={`sticky left-0 z-10 ${STICKY_NAME_WIDTH_CLASS} ${CELL_PAD} truncate border-r border-slate-200 bg-slate-100 text-left font-medium text-slate-950 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100`}
                >
                  {student.name}
                </th>
                <td
                  role="gridcell"
                  tabIndex={-1}
                  aria-label={`Final course percentage for ${student.name}`}
                  className={`sticky left-[12rem] z-[9] ${CELL_PAD} min-w-[5.5rem] border-r border-slate-200 bg-slate-50 text-right tabular-nums text-slate-800 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200`}
                >
                  {formatFinalPercent(finalPercentByStudentId[student.id] ?? null)}
                </td>
                {visibleColumns.map((col, colIndex) => {
                  const inRect =
                    selectionRect != null &&
                    row >= selectionRect.row0 &&
                    row <= selectionRect.row1 &&
                    colIndex >= selectionRect.col0 &&
                    colIndex <= selectionRect.col1
                  const isFocusCell = focusRow === row && focusCol === colIndex
                  const isActive = isFocusCell && !editing
                  const showEditor = editing != null && row === focusRow && colIndex === focusCol
                  const inEditBand = editing != null && inRect && !showEditor
                  const val = displayValue(row, colIndex)

                  const ringActive =
                    'relative z-[1] bg-indigo-50 ring-2 ring-inset ring-indigo-500 dark:bg-indigo-950/50 dark:ring-indigo-400'
                  const ringBand = 'bg-indigo-50/70 ring-1 ring-inset ring-indigo-400/70 dark:bg-indigo-950/40 dark:ring-indigo-500/50'
                  const ringBandEdit = 'bg-indigo-50/60 ring-1 ring-inset ring-indigo-400/80 dark:bg-indigo-950/35 dark:ring-indigo-500/60'

                  const inFillDest =
                    fillDrag != null &&
                    row >= fillDrag.src.row0 &&
                    row <= fillDrag.destRow1 &&
                    colIndex >= fillDrag.src.col0 &&
                    colIndex <= fillDrag.destCol1
                  const inFillSource =
                    fillDrag != null &&
                    row >= fillDrag.src.row0 &&
                    row <= fillDrag.src.row1 &&
                    colIndex >= fillDrag.src.col0 &&
                    colIndex <= fillDrag.src.col1
                  const inFillExtension = inFillDest && !inFillSource

                  const cellSurface = showEditor
                    ? ringActive
                    : inEditBand
                      ? ringBandEdit
                      : inRect && isFocusCell && !editing
                        ? ringActive
                        : inRect
                          ? ringBand
                          : isFocusCell && !editing
                            ? ringActive
                            : 'bg-white dark:bg-neutral-900/80'

                  const fillExtSurface = inFillExtension
                    ? 'bg-indigo-100/45 ring-1 ring-inset ring-dashed ring-indigo-400/80 dark:bg-indigo-950/35 dark:ring-indigo-500/70'
                    : ''

                  const showFillKnob =
                    !readOnly &&
                    !editing &&
                    !fillDrag &&
                    activeSelectionBounds != null &&
                    row === activeSelectionBounds.row1 &&
                    colIndex === activeSelectionBounds.col1

                  return (
                    <td
                      key={col.id}
                      ref={(el) => setCellRef(row, colIndex, el)}
                      role="gridcell"
                      data-gradebook-cell="1"
                      data-gradebook-row={String(row)}
                      data-gradebook-col={String(colIndex)}
                      tabIndex={isActive ? 0 : -1}
                      aria-selected={
                        inRect || showEditor || (isFocusCell && !editing && selectionRect == null)
                      }
                      className={`relative ${CELL_PAD} min-w-[5.5rem] border-l border-slate-100 text-right tabular-nums outline-none transition dark:border-neutral-700/80 ${cellSurface} ${fillExtSurface}`}
                      onKeyDown={(e) => handleGradeCellKeyDown(e, row, colIndex)}
                      onPointerDown={(e) => {
                        if (e.button !== 0) return
                        if (fillDragRef.current != null) return
                        dragSelectStartRef.current = { row, col: colIndex }
                        dragDidMoveRef.current = false
                      }}
                      onPointerEnter={(e) => {
                        if (fillDragRef.current != null) return
                        if ((e.buttons & 1) === 0) return
                        const start = dragSelectStartRef.current
                        if (!start) return
                        if (row === start.row && colIndex === start.col) return
                        dragDidMoveRef.current = true
                        setSelectionAnchor({ row: start.row, col: start.col })
                        focusCell(row, colIndex, { clearSelectionAnchor: false })
                      }}
                      onClick={(e) => {
                        if (skipNextCellClickRef.current) {
                          skipNextCellClickRef.current = false
                          dragSelectStartRef.current = null
                          return
                        }
                        if (editing && (row !== focusRow || colIndex !== focusCol)) {
                          commitEdit()
                        }
                        if (e.shiftKey) {
                          setSelectionAnchor((a) => a ?? { row: focusRow, col: focusCol })
                          focusCell(row, colIndex, { clearSelectionAnchor: false })
                        } else if (!dragDidMoveRef.current) {
                          focusCell(row, colIndex)
                        }
                        dragSelectStartRef.current = null
                      }}
                      onDoubleClick={() => beginEdit(row, colIndex, { range: 'single' })}
                    >
                      {showEditor ? (
                        <input
                          ref={editInputRef}
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          aria-label={`Grade for ${student.name}, ${col.title}`}
                          className="m-0 w-full min-w-0 border-0 bg-transparent p-0 text-right text-sm tabular-nums text-slate-950 shadow-none outline-none ring-0 focus:ring-0 dark:text-neutral-100"
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={handleInputKeyDown}
                          onBlur={handleEditInputBlur}
                        />
                      ) : (
                        <div className="flex flex-col items-end gap-0.5">
                          <span
                            className={
                              val ? 'text-slate-950 dark:text-neutral-100' : 'text-neutral-400 dark:text-neutral-500'
                            }
                          >
                            {val || '—'}
                          </span>
                          {!readOnly && col.rubric && onRubricClick ? (
                            <button
                              type="button"
                              className="text-[11px] font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                              onClick={(e) => {
                                e.stopPropagation()
                                onRubricClick(student.id, col.id)
                              }}
                            >
                              Rubric
                            </button>
                          ) : null}
                        </div>
                      )}
                      {showFillKnob && activeSelectionBounds != null && (
                        <button
                          type="button"
                          tabIndex={-1}
                          aria-label="Fill — drag to copy the selection down or across"
                          className="absolute -bottom-px -right-px z-[3] h-2.5 w-2.5 cursor-crosshair border border-white bg-indigo-600 shadow-sm hover:bg-indigo-500 dark:border-neutral-900 dark:bg-indigo-500 dark:hover:bg-indigo-400 touch-none"
                          onPointerDown={(e) => handleFillKnobPointerDown(e, activeSelectionBounds)}
                        />
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}

      {headerMenu?.kind === 'student' && (
        <HeaderSortMenuPortal menu={headerMenu} onClose={closeHeaderMenu}>
          <div className="border-b border-slate-100 px-3 py-1.5 text-xs font-medium text-slate-500 dark:border-neutral-700 dark:text-neutral-400">
            Sort students
          </div>
          <button type="button" className={menuItemClass()} onClick={() => pickStudentSort('first_az')}>
            First name (A → Z)
          </button>
          <button type="button" className={menuItemClass()} onClick={() => pickStudentSort('first_za')}>
            First name (Z → A)
          </button>
          <button type="button" className={menuItemClass()} onClick={() => pickStudentSort('last_az')}>
            Last name (A → Z)
          </button>
          <button type="button" className={menuItemClass()} onClick={() => pickStudentSort('last_za')}>
            Last name (Z → A)
          </button>
          <button type="button" className={menuItemClass()} onClick={() => pickStudentSort('display_az')}>
            Full name (A → Z)
          </button>
          <button type="button" className={menuItemClass()} onClick={() => pickStudentSort('display_za')}>
            Full name (Z → A)
          </button>
          <button type="button" className={`${menuItemClass()} text-slate-500 dark:text-neutral-500`} onClick={clearSort}>
            Reset to course order
          </button>
        </HeaderSortMenuPortal>
      )}

      {headerMenu?.kind === 'column' && headerMenu.columnId != null && (
        <HeaderSortMenuPortal menu={headerMenu} onClose={closeHeaderMenu}>
          <div className="border-b border-slate-100 px-3 py-1.5 text-xs font-medium text-slate-500 dark:border-neutral-700 dark:text-neutral-400">
            Sort by this column
          </div>
          <button
            type="button"
            className={menuItemClass()}
            onClick={() => pickGradeSort(headerMenu.columnId, 'submitted_first')}
          >
            Submitted first
          </button>
          <button
            type="button"
            className={menuItemClass()}
            title="Uses the same ordering as “Submitted first” until late status is tracked in the LMS."
            onClick={() => pickGradeSort(headerMenu.columnId, 'late_first')}
          >
            Late first
          </button>
          <button
            type="button"
            className={menuItemClass()}
            onClick={() => pickGradeSort(headerMenu.columnId, 'unsubmitted_first')}
          >
            Unsubmitted first
          </button>
          <button
            type="button"
            className={menuItemClass()}
            onClick={() => pickGradeSort(headerMenu.columnId, 'grade_az')}
          >
            Grade (A → Z)
          </button>
          <button
            type="button"
            className={menuItemClass()}
            onClick={() => pickGradeSort(headerMenu.columnId, 'grade_za')}
          >
            Grade (Z → A)
          </button>
          <button type="button" className={`${menuItemClass()} text-slate-500 dark:text-neutral-500`} onClick={clearSort}>
            Reset to course order
          </button>
        </HeaderSortMenuPortal>
      )}

      <p className="text-xs text-slate-500 dark:text-neutral-400">
        <span className="font-medium text-slate-600 dark:text-neutral-300">Shortcuts:</span> click or arrows move
        the active cell; drag or Shift+arrows / Shift+click extends a rectangular selection; Delete or Backspace
        clears scores for the selection; Enter or F2 edits (filling every selected cell); Escape collapses a
        multi-cell selection or cancels editing; Tab / Shift+Tab moves to the next or previous cell; double-click
        edits one cell only. Drag the small square at the bottom-right of the selection (like Excel) to copy
        values down or across — a multi-cell selection repeats as a tiled pattern. Click a column header to open
        sort options.
        {footerNote ? ` ${footerNote}` : ''}
      </p>
    </div>
  )
}
