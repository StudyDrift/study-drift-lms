import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import App from '../App'
import { server } from '../test/mocks/server'
import { renderWithRouter } from '../test/render'
import Login from './Login'

describe('Login', () => {
  it('renders sign in heading and Lextures branding', () => {
    renderWithRouter(<Login />, { route: '/login', path: '/login' })
    expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /lextures/i })).toBeInTheDocument()
  })

  it('submits credentials and navigates to the LMS dashboard', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/login']}>
        <App />
      </MemoryRouter>,
    )

    await user.type(screen.getByLabelText(/^email$/i), 'learner@example.com')
    await user.type(screen.getByLabelText(/^password$/i), 'hunter2correct')
    await user.click(screen.getByRole('button', { name: /^sign in$/i }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /^dashboard$/i })).toBeInTheDocument()
    })
  })

  it('shows the API error message when credentials are rejected', async () => {
    server.use(
      http.post('http://localhost:8080/api/v1/auth/login', () =>
        HttpResponse.json(
          {
            error: {
              code: 'INVALID_CREDENTIALS',
              message: 'Invalid email or password.',
            },
          },
          { status: 401 },
        ),
      ),
    )

    const { user } = renderWithRouter(<Login />, { route: '/login', path: '/login' })

    await user.type(screen.getByLabelText(/^email$/i), 'x@y.z')
    await user.type(screen.getByLabelText(/^password$/i), 'wrong')
    await user.click(screen.getByRole('button', { name: /^sign in$/i }))

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/Invalid email or password/)
    })
  })

  it('shows a friendly error when the request fails at the network layer', async () => {
    server.use(
      http.post('http://localhost:8080/api/v1/auth/login', () => HttpResponse.error()),
    )

    const { user } = renderWithRouter(<Login />, { route: '/login', path: '/login' })

    await user.type(screen.getByLabelText(/^email$/i), 'a@b.c')
    await user.type(screen.getByLabelText(/^password$/i), 'secret')
    await user.click(screen.getByRole('button', { name: /^sign in$/i }))

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        /Could not reach the server\. Is the API running\?/,
      )
    })
  })
})
