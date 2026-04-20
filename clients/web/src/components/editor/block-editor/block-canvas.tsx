import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { useBlockEditor } from './block-editor-provider'

type BlockCanvasProps = {
  children: ReactNode
  /** Max width of the writing column (Gutenberg-like centered canvas). */
  maxWidthClassName?: string
  className?: string
}

/**
 * Clicking empty padding around blocks clears the current block selection.
 */
export function BlockCanvas({
  children,
  maxWidthClassName = 'max-w-[720px]',
  className,
}: BlockCanvasProps) {
  const { selectedId, setSelectedId } = useBlockEditor()

  useEffect(() => {
    if (!selectedId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, setSelectedId])

  return (
    <div
      className={['min-h-full px-4 py-8 sm:px-8 sm:py-10', className].filter(Boolean).join(' ')}
      onClick={() => setSelectedId(null)}
      role="presentation"
    >
      <div className={`${maxWidthClassName} mx-auto`}>{children}</div>
    </div>
  )
}
