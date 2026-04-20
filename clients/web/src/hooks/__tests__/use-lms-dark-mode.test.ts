import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useLmsDarkMode } from '../use-lms-dark-mode'

describe('useLmsDarkMode', () => {
  const el = document.documentElement

  afterEach(() => {
    el.classList.remove('dark')
  })

  it('reflects presence of the dark class on the document root', async () => {
    el.classList.remove('dark')
    const { result } = renderHook(() => useLmsDarkMode())
    await waitFor(() => expect(result.current).toBe(false))
    el.classList.add('dark')
    await waitFor(() => expect(result.current).toBe(true))
  })
})
