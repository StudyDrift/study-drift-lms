import type { Meta, StoryObj } from '@storybook/react-vite'
import { BookLoader } from './book-loader'

const meta = {
  title: 'Quiz/BookLoader',
  component: BookLoader,
} satisfies Meta<typeof BookLoader>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
