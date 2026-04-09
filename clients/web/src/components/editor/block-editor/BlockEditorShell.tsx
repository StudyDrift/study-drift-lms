import type { ReactNode } from 'react'

type BlockEditorShellProps = {
  /** Main canvas (blocks). */
  children: ReactNode
  /** Right settings column (tabs + panels). */
  sidebar: ReactNode
  className?: string
}

/**
 * Two-column Gutenberg-style layout: scrollable canvas + fixed settings sidebar.
 */
export function BlockEditorShell({ children, sidebar, className }: BlockEditorShellProps) {
  return (
    <div
      className={
        className ??
        'block-editor-root flex min-h-[min(70vh,720px)] w-full flex-col overflow-hidden rounded-xl border border-slate-200/90 bg-[#f0f0f0] shadow-sm shadow-slate-900/5 dark:border-slate-700 dark:bg-slate-950 dark:shadow-black/40 md:min-h-[min(75vh,880px)]'
      }
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-[#f0f0f0] dark:bg-slate-950">
          {children}
        </div>
        <aside className="flex max-h-[min(42vh,420px)] min-h-0 shrink-0 flex-col border-t border-slate-200/90 bg-white dark:border-slate-700 dark:bg-slate-900 md:max-h-none md:w-[280px] md:border-l md:border-t-0">
          {sidebar}
        </aside>
      </div>
    </div>
  )
}
