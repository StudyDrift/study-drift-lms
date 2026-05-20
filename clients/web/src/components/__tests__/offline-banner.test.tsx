import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { OfflineBanner } from '../offline-banner'

vi.mock('../../db/schema', () => ({
  drainPendingSync: vi.fn().mockResolvedValue({ sent: 0, failed: 0 }),
}))

function setOnlineStatus(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { value: online, writable: true, configurable: true })
}

describe('OfflineBanner', () => {
  beforeEach(() => {
    setOnlineStatus(true)
  })

  it('renders nothing when online', () => {
    setOnlineStatus(true)
    const { container } = render(<OfflineBanner />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the offline banner when offline', () => {
    setOnlineStatus(false)
    render(<OfflineBanner />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText(/You are offline/)).toBeInTheDocument()
    expect(screen.getByText(/viewing cached content/)).toBeInTheDocument()
  })

  it('has role="alert" and aria-live="assertive" for accessibility', () => {
    setOnlineStatus(false)
    render(<OfflineBanner />)
    const banner = screen.getByRole('alert')
    expect(banner).toHaveAttribute('aria-live', 'assertive')
    expect(banner).toHaveAttribute('aria-atomic', 'true')
  })

  it('appears when the browser goes offline', () => {
    setOnlineStatus(true)
    render(<OfflineBanner />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    act(() => {
      setOnlineStatus(false)
      window.dispatchEvent(new Event('offline'))
    })

    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('disappears when the browser comes back online', () => {
    setOnlineStatus(false)
    render(<OfflineBanner />)
    expect(screen.getByRole('alert')).toBeInTheDocument()

    act(() => {
      setOnlineStatus(true)
      window.dispatchEvent(new Event('online'))
    })

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
