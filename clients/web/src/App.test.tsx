import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import App from './App'
import { PermissionsProvider } from './context/PermissionsProvider'
import { clearAccessToken, setAccessToken } from './lib/auth'

describe('App routing', () => {
  beforeEach(() => {
    clearAccessToken()
  })

  it('redirects unauthenticated users from / to login', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <PermissionsProvider>
          <App />
        </PermissionsProvider>
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument()
  })

  it('renders signup at /signup', () => {
    render(
      <MemoryRouter initialEntries={['/signup']}>
        <PermissionsProvider>
          <App />
        </PermissionsProvider>
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { name: /create your account/i })).toBeInTheDocument()
  })

  it('shows the LMS dashboard at / when authenticated', () => {
    setAccessToken('test-token')
    render(
      <MemoryRouter initialEntries={['/']}>
        <PermissionsProvider>
          <App />
        </PermissionsProvider>
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { name: /^dashboard$/i })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: /main/i })).toBeInTheDocument()
  })

  it('redirects to login when auth becomes required during an active session', async () => {
    setAccessToken('test-token')
    render(
      <MemoryRouter initialEntries={['/courses']}>
        <PermissionsProvider>
          <App />
        </PermissionsProvider>
      </MemoryRouter>,
    )

    act(() => {
      clearAccessToken()
      window.dispatchEvent(new Event('studydrift-auth-required'))
    })

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument()
    })
  })
})
