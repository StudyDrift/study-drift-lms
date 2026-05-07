import type { ReactNode } from 'react'

type PublicAuthShellProps = {
  children: ReactNode
}

/**
 * Layout wrapper for public sign-in flows: warm neutral backdrop, no decorative “hero” gradient.
 */
export function PublicAuthShell({ children }: PublicAuthShellProps) {
  return (
    <div className="lex-auth-scene min-h-dvh text-stone-900">
      <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-12 sm:px-6 sm:py-16">
        <div className="relative z-10 w-full max-w-md">{children}</div>
      </main>
    </div>
  )
}
