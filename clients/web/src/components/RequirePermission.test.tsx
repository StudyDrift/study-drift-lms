import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RequirePermission } from './RequirePermission'

const allows = vi.fn()
const usePermissions = vi.fn()

vi.mock('../context/usePermissions', () => ({
  usePermissions: () => usePermissions(),
}))

describe('RequirePermission', () => {
  it('renders fallback while permissions load', () => {
    usePermissions.mockReturnValue({ allows, loading: true })
    render(
      <RequirePermission permission="a:b:c:d" fallback={<span>Wait</span>}>
        <span>Secret</span>
      </RequirePermission>,
    )
    expect(screen.getByText('Wait')).toBeInTheDocument()
    expect(screen.queryByText('Secret')).toBeNull()
  })

  it('renders children when allowed', () => {
    usePermissions.mockReturnValue({ allows, loading: false })
    allows.mockReturnValue(true)
    render(
      <RequirePermission permission="a:b:c:d">
        <span>Secret</span>
      </RequirePermission>,
    )
    expect(screen.getByText('Secret')).toBeInTheDocument()
    expect(allows).toHaveBeenCalledWith('a:b:c:d')
  })

  it('renders nothing when not allowed', () => {
    usePermissions.mockReturnValue({ allows, loading: false })
    allows.mockReturnValue(false)
    render(
      <RequirePermission permission="a:b:c:d">
        <span>Secret</span>
      </RequirePermission>,
    )
    expect(screen.queryByText('Secret')).toBeNull()
  })
})
