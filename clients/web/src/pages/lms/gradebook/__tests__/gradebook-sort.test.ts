import { describe, expect, it } from 'vitest'
import { compareStudentsByGradeColumn, compareStudentsForSort } from '../gradebook-sort'

describe('compareStudentsForSort', () => {
  it('orders by first name', () => {
    const a = { id: '1', name: 'Zara Smith' }
    const b = { id: '2', name: 'Amy Jones' }
    expect(compareStudentsForSort(a, b, 'first_az')).toBeGreaterThan(0)
    expect(compareStudentsForSort(b, a, 'first_az')).toBeLessThan(0)
  })

  it('orders by last name', () => {
    const a = { id: '1', name: 'Amy Zed' }
    const b = { id: '2', name: 'Amy Adams' }
    expect(compareStudentsForSort(a, b, 'last_az')).toBeGreaterThan(0)
  })
})

describe('compareStudentsByGradeColumn', () => {
  const grades = {
    u1: { c1: '10' },
    u2: { c1: '' },
    u3: { c1: '5' },
  }

  it('puts submitted rows first', () => {
    const s = (id: string, name: string) => ({ id, name })
    expect(
      compareStudentsByGradeColumn(s('u2', 'B'), s('u1', 'A'), grades, 'c1', 'submitted_first'),
    ).toBeGreaterThan(0)
  })

  it('sorts numeric grades A→Z (ascending)', () => {
    const s = (id: string, name: string) => ({ id, name })
    expect(compareStudentsByGradeColumn(s('u3', 'x'), s('u1', 'y'), grades, 'c1', 'grade_az')).toBeLessThan(0)
  })
})
