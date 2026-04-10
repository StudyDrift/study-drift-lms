import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react'
import type { MockAssignment, MockStudent } from './mockGradebookData'

type GradebookGridProps = {
  assignments: MockAssignment[]
  students: MockStudent[]
  initialGrades: Record<string, Record<string, string>>
}

const CELL_PAD = 'px-3 py-2 text-sm'

export function GradebookGrid({ assignments, students, initialGrades }: GradebookGridProps) {
  const [grades, setGrades] = useState<Record<string, Record<string, string>>>(() =>
    structuredClone(initialGrades),
  )
  const [focusRow, setFocusRow] = useState(0)
  const [focusCol, setFocusCol] = useState(0)
  const [editing, setEditing] = useState<{ row: number; col: number } | null>(null)
  const [draft, setDraft] = useState('')

  const rowCount = students.length
  const colCount = assignments.length
  const totalCells = rowCount * colCount

  const cellRefs = useRef<(HTMLTableCellElement | null)[][]>([])

  useEffect(() => {
    cellRefs.current = students.map(() => assignments.map(() => null))
  }, [students, assignments])

  const setCellRef = useCallback((row: number, col: number, el: HTMLTableCellElement | null) => {
    if (!cellRefs.current[row]) {
      cellRefs.current[row] = new Array(assignments.length).fill(null)
    }
    cellRefs.current[row][col] = el
  }, [assignments.length])

  const focusCell = useCallback((row: number, col: number) => {
    const r = Math.max(0, Math.min(rowCount - 1, row))
    const c = Math.max(0, Math.min(colCount - 1, col))
    setFocusRow(r)
    setFocusCol(c)
  }, [rowCount, colCount])

  useEffect(() => {
    if (!editing) {
      cellRefs.current[focusRow]?.[focusCol]?.focus()
    }
  }, [focusRow, focusCol, editing])

  const displayValue = useCallback(
    (row: number, col: number) => {
      const sid = students[row]!.id
      const aid = assignments[col]!.id
      return grades[sid]?.[aid] ?? ''
    },
    [grades, students, assignments],
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
    const sid = students[row]!.id
    const aid = assignments[col]!.id
    setGrades((prev) => ({
      ...prev,
      [sid]: { ...(prev[sid] ?? {}), [aid]: draft.trim() },
    }))
    setEditing(null)
  }, [editing, draft, students, assignments])

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
    [
      editing,
      focusRow,
      focusCol,
      colCount,
      moveBy,
      moveToIndex,
      beginEdit,
    ],
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
        const sid = students[row]!.id
        const aid = assignments[col]!.id
        setGrades((prev) => ({
          ...prev,
          [sid]: { ...(prev[sid] ?? {}), [aid]: draft.trim() },
        }))
        setEditing(null)
        moveToIndex(e.shiftKey ? idx - 1 : idx + 1)
      }
    },
    [commitEdit, cancelEdit, moveBy, moveToIndex, colCount, editing, draft, students, assignments],
  )

  return (
    <div className="mt-6 space-y-3">
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
                className={`sticky top-0 left-0 z-30 ${CELL_PAD} border-b border-r border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400`}
              >
                Student
              </th>
              {assignments.map((a) => (
                <th
                  key={a.id}
                  scope="col"
                  className={`sticky top-0 z-20 ${CELL_PAD} min-w-[9rem] border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-800 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200`}
                >
                  <div className="flex flex-col gap-0.5">
                    <span>{a.name}</span>
                    <span className="font-normal text-slate-500 dark:text-neutral-400">Out of {a.maxPoints}</span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {students.map((student, row) => (
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
                {assignments.map((a, col) => {
                  const isActive = focusRow === row && focusCol === col && !editing
                  const isEditing = editing?.row === row && editing?.col === col
                  const val = displayValue(row, col)

                  return (
                    <td
                      key={a.id}
                      ref={(el) => setCellRef(row, col, el)}
                      role="gridcell"
                      tabIndex={isActive ? 0 : -1}
                      aria-selected={isActive || isEditing}
                      className={`${CELL_PAD} min-w-[5.5rem] border-l border-slate-100 text-right tabular-nums outline-none transition dark:border-neutral-700/80 ${
                        isActive || isEditing
                          ? 'relative z-[1] bg-indigo-50 ring-2 ring-inset ring-indigo-500 dark:bg-indigo-950/50 dark:ring-indigo-400'
                          : 'bg-white dark:bg-neutral-900/80'
                      }`}
                      onKeyDown={(e) => handleGradeCellKeyDown(e, row, col)}
                      onClick={() => {
                        if (editing && (editing.row !== row || editing.col !== col)) {
                          commitEdit()
                        }
                        focusCell(row, col)
                      }}
                      onDoubleClick={() => beginEdit(row, col)}
                    >
                      {isEditing ? (
                        <input
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          aria-label={`Grade for ${student.name}, ${a.name}`}
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

      <p className="text-xs text-slate-500 dark:text-neutral-400">
        <span className="font-medium text-slate-600 dark:text-neutral-300">Shortcuts:</span> arrow keys move the cell;
        Enter or F2 edits; Tab / Shift+Tab moves to the next or previous cell; double-click a cell
        to edit. Changes are mock-only and are not saved.
      </p>
    </div>
  )
}
