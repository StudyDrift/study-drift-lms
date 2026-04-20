import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }

type State = { error: Error | null }

/**
 * Catches unhandled render errors in the authenticated app shell (e.g. bad API data shapes).
 * Network/API failures should still be handled by callers; this avoids a blank screen when something throws.
 */
export class ApiErrorBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('ApiErrorBoundary', error, info.componentStack)
  }

  override render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-dvh items-center justify-center bg-slate-50 p-6 dark:bg-neutral-950">
          <div className="max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
            <h1 className="text-lg font-semibold text-slate-900 dark:text-neutral-100">Something went wrong</h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-neutral-400">
              An unexpected error occurred while loading this view. You can try again, or refresh the page.
            </p>
            <button
              type="button"
              className="mt-6 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
              onClick={() => this.setState({ error: null })}
            >
              Try again
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
