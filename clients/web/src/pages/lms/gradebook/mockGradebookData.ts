export type MockAssignment = {
  id: string
  name: string
  maxPoints: number
}

export type MockStudent = {
  id: string
  name: string
}

export const mockAssignments: MockAssignment[] = [
  { id: 'asg-hw1', name: 'Homework 1', maxPoints: 100 },
  { id: 'asg-quiz1', name: 'Quiz 1', maxPoints: 50 },
  { id: 'asg-mid', name: 'Midterm', maxPoints: 100 },
  { id: 'asg-proj', name: 'Final project', maxPoints: 200 },
]

export const mockStudents: MockStudent[] = [
  { id: 'stu-1', name: 'Ada Lovelace' },
  { id: 'stu-2', name: 'Alan Turing' },
  { id: 'stu-3', name: 'Grace Hopper' },
  { id: 'stu-4', name: 'Edsger Dijkstra' },
  { id: 'stu-5', name: 'Barbara Liskov' },
]

/** Initial cell values (student id → assignment id → score text). */
export function buildInitialMockGrades(): Record<string, Record<string, string>> {
  return {
    'stu-1': { 'asg-hw1': '98', 'asg-quiz1': '47', 'asg-mid': '91', 'asg-proj': '185' },
    'stu-2': { 'asg-hw1': '82', 'asg-quiz1': '44', 'asg-mid': '76', 'asg-proj': '172' },
    'stu-3': { 'asg-hw1': '100', 'asg-quiz1': '50', 'asg-mid': '88', 'asg-proj': '195' },
    'stu-4': { 'asg-hw1': '76', 'asg-quiz1': '38', 'asg-mid': '70', 'asg-proj': '' },
    'stu-5': { 'asg-hw1': '90', 'asg-quiz1': '45', 'asg-mid': '', 'asg-proj': '160' },
  }
}

/** Stable module export for initial grid state (do not rebuild each render). */
export const initialMockGrades = buildInitialMockGrades()
