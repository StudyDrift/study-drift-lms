import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import App from './App'
import { PermissionsProvider } from './context/PermissionsContext'
import { setAccessToken } from './lib/auth'

describe('App routing', () => {
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
})
