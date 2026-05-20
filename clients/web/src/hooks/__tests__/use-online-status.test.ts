import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useOnlineStatus } from '../use-online-status'

// Mock drainPendingSync so it doesn't hit IndexedDB in these tests
vi.mock('../../db/schema', () => ({
  drainPendingSync: vi.fn().mockResolvedValue({ sent: 0, failed: 0 }),
}))

function setOnlineStatus(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { value: online, writable: true, configurable: true })
}

describe('useOnlineStatus', () => {
  beforeEach(() => {
    setOnlineStatus(true)
  })

  it('returns true when navigator.onLine is true', () => {
    setOnlineStatus(true)
    const { result } = renderHook(() => useOnlineStatus())
    expect(result.current).toBe(true)
  })

  it('returns false when navigator.onLine is false', () => {
    setOnlineStatus(false)
    const { result } = renderHook(() => useOnlineStatus())
    expect(result.current).toBe(false)
  })

  it('updates to false when offline event fires', () => {
    setOnlineStatus(true)
    const { result } = renderHook(() => useOnlineStatus())
    expect(result.current).toBe(true)

    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
    expect(result.current).toBe(false)
  })

  it('updates to true when online event fires', () => {
    setOnlineStatus(false)
    const { result } = renderHook(() => useOnlineStatus())
    expect(result.current).toBe(false)

    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    expect(result.current).toBe(true)
  })

  it('calls drainPendingSync when coming back online', async () => {
    const { drainPendingSync } = await import('../../db/schema')
    setOnlineStatus(false)
    renderHook(() => useOnlineStatus())

    act(() => {
      window.dispatchEvent(new Event('online'))
    })

    await vi.waitFor(() => {
      expect(drainPendingSync).toHaveBeenCalled()
    })
  })

  it('cleans up event listeners on unmount', () => {
    const addSpy = vi.spyOn(window, 'addEventListener')
    const removeSpy = vi.spyOn(window, 'removeEventListener')

    const { unmount } = renderHook(() => useOnlineStatus())
    expect(addSpy).toHaveBeenCalledWith('online', expect.any(Function))
    expect(addSpy).toHaveBeenCalledWith('offline', expect.any(Function))

    unmount()
    expect(removeSpy).toHaveBeenCalledWith('online', expect.any(Function))
    expect(removeSpy).toHaveBeenCalledWith('offline', expect.any(Function))
  })
})
