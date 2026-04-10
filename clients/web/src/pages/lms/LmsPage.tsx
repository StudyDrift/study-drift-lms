import type { ReactNode, RefObject } from 'react'

type LmsPageProps = {
  title: string
  /** When set, replaces the default page `<h1>` (keep `title` for fallbacks and consistency). */
  titleContent?: ReactNode
  description?: string
  /** Renders in the top-right of the header row (e.g. primary actions). */
  actions?: ReactNode
  /** Attached to the actions wrapper for layout measurements (e.g. aligning a content aside). */
  actionsContainerRef?: RefObject<HTMLDivElement | null>
  children?: ReactNode
}

export function LmsPage({
  title,
  titleContent,
  description,
  actions,
  actionsContainerRef,
  children,
}: LmsPageProps) {
  return (
    <div className="px-4 py-5 sm:p-6 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          {titleContent ?? (
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-neutral-100">{title}</h1>
          )}
          {description && (
            <p className="mt-2 max-w-2xl text-xs text-slate-500 dark:text-neutral-400">{description}</p>
          )}
        </div>
        {actions ? (
          <div ref={actionsContainerRef} className="w-full shrink-0 pt-0.5 sm:w-auto">
            {actions}
          </div>
        ) : null}
      </div>
      {children}
    </div>
  )
}
