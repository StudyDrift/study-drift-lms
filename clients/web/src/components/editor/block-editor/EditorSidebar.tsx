import { useState, type ReactNode } from 'react'

export type EditorSidebarTab = 'document' | 'block'

export type EditorSidebarProps = {
  documentLabel?: string
  blockLabel?: string
  documentPanel: ReactNode
  blockPanel: ReactNode
  /** When true, Block tab shows a disabled empty state. */
  blockDisabled?: boolean
  blockDisabledMessage?: string
}

/**
 * Right column tabs: global document settings vs. selected block (Gutenberg-style).
 */
export function EditorSidebar({
  documentLabel = 'Document',
  blockLabel = 'Block',
  documentPanel,
  blockPanel,
  blockDisabled,
  blockDisabledMessage = 'Select a block to see its settings.',
}: EditorSidebarProps) {
  const [tab, setTab] = useState<EditorSidebarTab>('block')

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className="flex shrink-0 border-b border-slate-200 dark:border-slate-700"
        role="tablist"
        aria-label="Editor settings"
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'document'}
          className={`flex-1 px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-wide transition ${
            tab === 'document'
              ? 'border-b-2 border-indigo-600 text-slate-900 dark:border-indigo-500 dark:text-slate-100'
              : 'border-b-2 border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
          }`}
          onClick={() => setTab('document')}
        >
          {documentLabel}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'block'}
          className={`flex-1 px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-wide transition ${
            tab === 'block'
              ? 'border-b-2 border-indigo-600 text-slate-900 dark:border-indigo-500 dark:text-slate-100'
              : 'border-b-2 border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
          }`}
          onClick={() => setTab('block')}
        >
          {blockLabel}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3" role="tabpanel">
        {tab === 'document' && documentPanel}
        {tab === 'block' &&
          (blockDisabled ? (
            <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-sm text-slate-500 dark:border-slate-600 dark:bg-slate-800/80 dark:text-slate-300">
              {blockDisabledMessage}
            </p>
          ) : (
            blockPanel
          ))}
      </div>
    </div>
  )
}
