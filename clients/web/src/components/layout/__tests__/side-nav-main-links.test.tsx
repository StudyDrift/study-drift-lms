import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { PERM_REPORTS_VIEW } from '../../../lib/rbac-api'
import { SideNavMainLinks } from '../side-nav-main-links'

vi.mock('../../../context/use-inbox-unread', () => ({
  useInboxUnreadCount: () => 2,
}))

vi.mock('../../../context/use-permissions', () => ({
  usePermissions: () => ({
    allows: (p: string) => p === PERM_REPORTS_VIEW,
    loading: false,
  }),
}))

describe('SideNavMainLinks', () => {
  it('renders core navigation and unread badge when inbox has items', () => {
    render(
      <MemoryRouter>
        <SideNavMainLinks />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: /^dashboard$/i })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: /^courses$/i })).toHaveAttribute('href', '/courses')
    expect(screen.getByLabelText('2 unread')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^reports$/i })).toBeInTheDocument()
  })
})
