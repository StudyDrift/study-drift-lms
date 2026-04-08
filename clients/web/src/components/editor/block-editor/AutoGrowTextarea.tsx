import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type TextareaHTMLAttributes,
} from 'react'

export type AutoGrowTextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'rows'> & {
  /** Minimum height in px when empty (default ~3 lines at 15px). */
  minHeightPx?: number
}

/**
 * Textarea that grows with content; no resize handle (Gutenberg-style body field).
 */
export const AutoGrowTextarea = forwardRef<HTMLTextAreaElement, AutoGrowTextareaProps>(
  function AutoGrowTextarea({ value, minHeightPx = 120, className, onChange, ...rest }, ref) {
    const innerRef = useRef<HTMLTextAreaElement>(null)

    useImperativeHandle(ref, () => innerRef.current as HTMLTextAreaElement, [])

    useLayoutEffect(() => {
      const el = innerRef.current
      if (!el) return
      el.style.height = '0px'
      const next = Math.max(minHeightPx, el.scrollHeight)
      el.style.height = `${next}px`
    }, [value, minHeightPx])

    return (
      <textarea
        ref={innerRef}
        value={value}
        onChange={onChange}
        rows={1}
        className={['resize-none overflow-hidden', className].filter(Boolean).join(' ')}
        {...rest}
      />
    )
  },
)
