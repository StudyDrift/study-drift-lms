import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import App from '../App'
import { server } from '../test/mocks/server'
import { renderWithRouter } from '../test/render'
import Signup from './Signup'

describe('Signup', () => {
  it('renders create account heading', () => {
    renderWithRouter(<Signup />, { route: '/signup', path: '/signup' })
    expect(screen.getByRole('heading', { name: /create your account/i })).toBeInTheDocument()
  })

  it('submits email and password and navigates to the dashboard', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/signup']}>
        <App />
      </MemoryRouter>,
    )

    await user.type(screen.getByLabelText(/^email$/i), 'new@example.com')
    await user.type(screen.getByLabelText(/^password$/i), 'password12')
    await user.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /^dashboard$/i })).toBeInTheDocument()
    })
  })

  it('navigates to the dashboard when a display name is provided', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/signup']}>
        <App />
      </MemoryRouter>,
    )

    await user.type(screen.getByLabelText(/display name/i), 'Alex')
    await user.type(screen.getByLabelText(/^email$/i), 'alex@example.com')
    await user.type(screen.getByLabelText(/^password$/i), 'password12')
    await user.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /^dashboard$/i })).toBeInTheDocument()
    })
  })

  it('shows a friendly error when signup fails at the network layer', async () => {
    server.use(
      http.post('http://localhost:8080/api/v1/auth/signup', () => HttpResponse.error()),
    )

    const { user } = renderWithRouter(<Signup />, { route: '/signup', path: '/signup' })

    await user.type(screen.getByLabelText(/^email$/i), 'a@b.c')
    await user.type(screen.getByLabelText(/^password$/i), 'password12')
    await user.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        /Could not reach the server\. Is the API running\?/,
      )
    })
  })
})
