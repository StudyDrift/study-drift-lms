import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { NotificationPreferencesPanel } from '../notification-preferences-panel'

vi.mock('../../../lib/api', () => ({
  authorizedFetch: vi.fn(),
}))

import { authorizedFetch } from '../../../lib/api'

describe('NotificationPreferencesPanel', () => {
  it('loads and displays preference rows', async () => {
    vi.mocked(authorizedFetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        preferences: [
          {
            eventType: 'grade_posted',
            emailEnabled: true,
            pushEnabled: true,
            digestMode: 'instant',
          },
        ],
      }),
    } as Response)

    render(<NotificationPreferencesPanel />)

    await waitFor(() => {
      expect(screen.getByText('Grade posted')).toBeInTheDocument()
    })
    expect(screen.getByRole('switch', { name: /email for grade posted/i })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('saves updated preferences', async () => {
    vi.mocked(authorizedFetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          preferences: [
            {
              eventType: 'grade_posted',
              emailEnabled: true,
              pushEnabled: true,
              digestMode: 'instant',
            },
          ],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          preferences: [
            {
              eventType: 'grade_posted',
              emailEnabled: false,
              pushEnabled: true,
              digestMode: 'off',
            },
          ],
        }),
      } as Response)

    const user = userEvent.setup()
    render(<NotificationPreferencesPanel />)

    await waitFor(() => {
      expect(screen.getByText('Grade posted')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('switch', { name: /email for grade posted/i }))
    await user.click(screen.getByRole('button', { name: /save preferences/i }))

    await waitFor(() => {
      expect(authorizedFetch).toHaveBeenCalledWith(
        '/api/v1/me/notification-preferences',
        expect.objectContaining({ method: 'PUT' }),
      )
    })
  })
})
