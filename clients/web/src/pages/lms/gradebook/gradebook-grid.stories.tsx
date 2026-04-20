import type { Meta, StoryObj } from '@storybook/react'
import { GradebookGrid } from './gradebook-grid'

const meta = {
  title: 'LMS/Gradebook/GradebookGrid',
  component: GradebookGrid,
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta<typeof GradebookGrid>

export default meta
type Story = StoryObj<typeof meta>

export const ReadOnly: Story = {
  args: {
    columns: [
      { id: 'hw1', title: 'Homework 1', maxPoints: 10 },
      { id: 'mid', title: 'Midterm', maxPoints: 100 },
    ],
    students: [
      { id: 's1', name: 'Ada Lovelace' },
      { id: 's2', name: 'Alan Turing' },
    ],
    initialGrades: {
      s1: { hw1: '9', mid: '88' },
      s2: { hw1: '10', mid: '92' },
    },
    readOnly: true,
    footerNote: 'Storybook sample — grades are not persisted.',
  },
}

export const Editable: Story = {
  args: {
    ...ReadOnly.args,
    readOnly: false,
  },
}
