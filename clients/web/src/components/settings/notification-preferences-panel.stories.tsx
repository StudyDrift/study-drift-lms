import type { Meta, StoryObj } from '@storybook/react-vite'
import { NotificationPreferencesPanel } from './notification-preferences-panel'

const meta = {
  title: 'LMS/Settings/NotificationPreferences',
  component: NotificationPreferencesPanel,
  parameters: {
    layout: 'padded',
  },
} satisfies Meta<typeof NotificationPreferencesPanel>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <div className="max-w-3xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
      <h2 className="text-base font-semibold text-slate-900 dark:text-neutral-100">Notifications</h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
        Control which events send you email and whether they arrive instantly or in a daily digest.
      </p>
      <NotificationPreferencesPanel />
    </div>
  ),
}
