import '@testing-library/jest-dom/vitest'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { clearAccessToken } from '../lib/auth'
import { server } from './mocks/server'

/** jsdom does not implement ResizeObserver; `TopBar` uses it for layout. */
class ResizeObserverPolyfill {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver = globalThis.ResizeObserver ?? ResizeObserverPolyfill

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' })
})

afterEach(() => {
  server.resetHandlers()
  clearAccessToken()
})

afterAll(() => {
  server.close()
})
