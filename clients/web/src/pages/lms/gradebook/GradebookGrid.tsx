import {
  type KeyboardEvent,
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

export type GradebookColumn = {
  id: string
  title: string
  maxPoints: number | null
}

export type GradebookStudent = {
  id: string
  name: string
}

type GradebookGridProps = {
  columns: GradebookColumn[]
  students: GradebookStudent[]
  initialGrades: Record<string, Record<string, string>>
  footerNote?: string
}

const CELL_PAD = 'px-3 py-2 text-sm'

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

export function GradebookGrid({ columns, students, initialGrades, footerNote }: GradebookGridProps) {
  const [grades, setGrades] = useState<Record<string, Record<string, string>>>(() =>
    structuredClone(initialGrades),
  )
  const [activeSort, setActiveSort] = useState<GradebookActiveSort | null>(null)
  const [headerMenu, setHeaderMenu] = useState<HeaderMenuState>(null)
  const [studentFilter, setStudentFilter] = useState('')
  const [assignmentFilter, setAssignmentFilter] = useState('')
  const [focusRow, setFocusRow] = useState(0)
  const [focusCol, setFocusCol] = useState(0)
  const [editing, setEditing] = useState<{ row: number; col: number } | null>(null)
  const [draft, setDraft] = useState('')

  const focusStudentIdRef = useRef<string | null>(null)
  const focusRowRef = useRef(0)
  focusRowRef.current = focusRow

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

  const cellRefs = useRef<(HTMLTableCellElement | null)[][]>([])

  useEffect(() => {
    setGrades(structuredClone(initialGrades))
    setActiveSort(null)
    setHeaderMenu(null)
    setStudentFilter('')
    setAssignmentFilter('')
    setFocusRow(0)
    setFocusCol(0)
    setEditing(null)
    setDraft('')
    focusStudentIdRef.current = students[0]?.id ?? null
  }, [initialGrades, students, columns])

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
    (row: number, col: number) => {
      if (rowCount === 0 || colCount === 0) return
      const r = Math.max(0, Math.min(rowCount - 1, row))
      const c = Math.max(0, Math.min(colCount - 1, col))
      setFocusRow(r)
      setFocusCol(c)
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
    (row: number, col: number) => {
      setDraft(displayValue(row, col))
      setEditing({ row, col })
    },
    [displayValue],
  )

  const commitEdit = useCallback(() => {
    if (!editing) return
    const { row, col } = editing
    const sid = filteredStudents[row]!.id
    const aid = visibleColumns[col]!.id
    setGrades((prev) => ({
      ...prev,
      [sid]: { ...(prev[sid] ?? {}), [aid]: draft.trim() },
    }))
    setEditing(null)
  }, [editing, draft, filteredStudents, visibleColumns])

  const cancelEdit = useCallback(() => {
    setEditing(null)
  }, [])

  const moveBy = useCallback(
    (deltaRow: number, deltaCol: number) => {
      focusCell(focusRow + deltaRow, focusCol + deltaCol)
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

  const handleGradeCellKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTableCellElement>, row: number, col: number) => {
      if (editing) return
      if (row !== focusRow || col !== focusCol) return

      const idx = row * colCount + col

      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault()
          moveBy(-1, 0)
          break
        case 'ArrowDown':
          e.preventDefault()
          moveBy(1, 0)
          break
        case 'ArrowLeft':
          e.preventDefault()
          moveBy(0, -1)
          break
        case 'ArrowRight':
          e.preventDefault()
          moveBy(0, 1)
          break
        case 'Enter':
        case 'F2':
          e.preventDefault()
          beginEdit(row, col)
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
    [editing, focusRow, focusCol, colCount, moveBy, moveToIndex, beginEdit],
  )

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
        const { row, col } = editing
        const idx = row * colCount + col
        const sid = filteredStudents[row]!.id
        const aid = visibleColumns[col]!.id
        setGrades((prev) => ({
          ...prev,
          [sid]: { ...(prev[sid] ?? {}), [aid]: draft.trim() },
        }))
        setEditing(null)
        moveToIndex(e.shiftKey ? idx - 1 : idx + 1)
      }
    },
    [commitEdit, cancelEdit, moveBy, moveToIndex, colCount, editing, draft, filteredStudents, visibleColumns],
  )

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

      {rowCount > 0 && colCount > 0 && (
      <div className="overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
        <table
          role="grid"
          aria-label="Grades by student and assignment"
          aria-rowcount={rowCount + 1}
          aria-colcount={colCount + 1}
          className="w-full min-w-max border-collapse text-left"
        >
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 dark:border-neutral-700 dark:bg-neutral-800">
              <th
                scope="col"
                className={`sticky top-0 left-0 z-30 ${CELL_PAD} border-b border-r border-slate-200 bg-slate-50 align-bottom dark:border-neutral-700 dark:bg-neutral-800`}
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
                  className={`sticky left-0 z-10 ${CELL_PAD} border-r border-slate-200 bg-slate-100 text-left font-medium text-slate-950 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100`}
                >
                  {student.name}
                </th>
                {visibleColumns.map((col, colIndex) => {
                  const isActive = focusRow === row && focusCol === colIndex && !editing
                  const isEditing = editing?.row === row && editing?.col === colIndex
                  const val = displayValue(row, colIndex)

                  return (
                    <td
                      key={col.id}
                      ref={(el) => setCellRef(row, colIndex, el)}
                      role="gridcell"
                      tabIndex={isActive ? 0 : -1}
                      aria-selected={isActive || isEditing}
                      className={`${CELL_PAD} min-w-[5.5rem] border-l border-slate-100 text-right tabular-nums outline-none transition dark:border-neutral-700/80 ${
                        isActive || isEditing
                          ? 'relative z-[1] bg-indigo-50 ring-2 ring-inset ring-indigo-500 dark:bg-indigo-950/50 dark:ring-indigo-400'
                          : 'bg-white dark:bg-neutral-900/80'
                      }`}
                      onKeyDown={(e) => handleGradeCellKeyDown(e, row, colIndex)}
                      onClick={() => {
                        if (editing && (editing.row !== row || editing.col !== colIndex)) {
                          commitEdit()
                        }
                        focusCell(row, colIndex)
                      }}
                      onDoubleClick={() => beginEdit(row, colIndex)}
                    >
                      {isEditing ? (
                        <input
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          aria-label={`Grade for ${student.name}, ${col.title}`}
                          className="w-full min-w-0 rounded border border-indigo-300 bg-white px-2 py-1 text-right text-sm text-slate-950 tabular-nums shadow-sm outline-none focus:border-indigo-500 dark:border-indigo-500 dark:bg-neutral-950 dark:text-neutral-100 dark:focus:border-indigo-400"
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={handleInputKeyDown}
                          onBlur={commitEdit}
                        />
                      ) : (
                        <span
                          className={
                            val ? 'text-slate-950 dark:text-neutral-100' : 'text-neutral-400 dark:text-neutral-500'
                          }
                        >
                          {val || '—'}
                        </span>
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
        <span className="font-medium text-slate-600 dark:text-neutral-300">Shortcuts:</span> arrow keys move the
        cell; Enter or F2 edits; Tab / Shift+Tab moves to the next or previous cell; double-click a cell to edit.
        Click a column header to open sort options.
        {footerNote ? ` ${footerNote}` : ''}
      </p>
    </div>
  )
}
