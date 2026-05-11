import type { Meta, StoryObj } from '@storybook/react-vite'
import { EnrollmentRoleBadge } from './enrollment-role-badge'

const meta = {
  title: 'LMS/Enrollments/EnrollmentRoleBadge',
  component: EnrollmentRoleBadge,
  parameters: {
    layout: 'centered',
  },
} satisfies Meta<typeof EnrollmentRoleBadge>

export default meta
type Story = StoryObj<typeof meta>

export const ExtendedRoles: Story = {
  args: { courseRoleKey: 'ta', roleDisplay: 'Teaching assistant' },
  render: () => (
    <div className="flex max-w-md flex-wrap gap-2 bg-white p-6 dark:bg-neutral-950">
      <EnrollmentRoleBadge courseRoleKey="ta" roleDisplay="Teaching assistant" />
      <EnrollmentRoleBadge courseRoleKey="designer" roleDisplay="Designer" />
      <EnrollmentRoleBadge courseRoleKey="observer" roleDisplay="Observer" />
      <EnrollmentRoleBadge courseRoleKey="auditor" roleDisplay="Auditor" />
      <EnrollmentRoleBadge courseRoleKey="librarian" roleDisplay="Librarian" />
      <EnrollmentRoleBadge courseRoleKey="teacher" roleDisplay="Teacher" />
      <EnrollmentRoleBadge courseRoleKey="instructor" roleDisplay="Instructor" />
      <EnrollmentRoleBadge courseRoleKey="student" roleDisplay="Student" />
    </div>
  ),
}
