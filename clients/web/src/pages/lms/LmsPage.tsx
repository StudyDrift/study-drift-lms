import type { ReactNode } from 'react'

type LmsPageProps = {
  title: string
  description?: string
  /** Renders in the top-right of the header row (e.g. primary actions). */
  actions?: ReactNode
  children?: ReactNode
}

export function LmsPage({ title, description, actions, children }: LmsPageProps) {
  return (
    <div className="p-6 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
          {description && (
            <p className="mt-2 max-w-2xl text-sm text-slate-500">{description}</p>
          )}
        </div>
        {actions ? <div className="shrink-0 pt-0.5">{actions}</div> : null}
      </div>
      {children}
    </div>
  )
}
