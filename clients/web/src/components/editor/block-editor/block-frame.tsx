import type { ReactNode } from 'react'
import { useBlockEditor } from './block-editor-provider'

export type BlockFrameProps = {
  blockId: string
  /** Toolbar shown above the block on hover, focus, or selection. */
  toolbar?: ReactNode
  children: ReactNode
  className?: string
}

/**
 * Wraps a single block: Gutenberg-style left accent, floating toolbar above, hover/focus affordances.
 */
export function BlockFrame({ blockId, toolbar, children, className }: BlockFrameProps) {
  const { selectedId, setSelectedId, disabled } = useBlockEditor()
  const selected = selectedId === blockId

  return (
    <div
      className={['group relative mb-2', className].filter(Boolean).join(' ')}
      onClick={(e) => {
        e.stopPropagation()
        setSelectedId(blockId)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.stopPropagation()
          setSelectedId(blockId)
        }
      }}
      role="group"
      aria-label="Content block"
    >
      {toolbar && (
        <div
          className={[
            'absolute bottom-full left-0 z-20 mb-1 flex w-full justify-start transition-opacity duration-150',
            selected
              ? 'visible opacity-100'
              : 'invisible opacity-0 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100',
          ].join(' ')}
        >
          {toolbar}
        </div>
      )}
      <div
        className={[
          'border-l-2 border-transparent pl-3 transition-colors',
          selected ? 'border-indigo-600 dark:border-indigo-400' : '',
          disabled ? 'opacity-60' : '',
        ].join(' ')}
      >
        {children}
      </div>
    </div>
  )
}
