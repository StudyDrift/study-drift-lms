import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

type RenderWithRouterOptions = {
  /** Initial history entry (must match a defined `path`). */
  route?: string
  /** Route pattern for the rendered page. */
  path?: string
}

/**
 * Renders a page inside `react-router` the same way the app does, with a configured user-event instance.
 */
export function renderWithRouter(ui: ReactElement, { route = '/', path = '/' }: RenderWithRouterOptions = {}) {
  const user = userEvent.setup()
  return {
    user,
    ...render(
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path={path} element={ui} />
        </Routes>
      </MemoryRouter>,
    ),
  }
}
