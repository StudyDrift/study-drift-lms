import { useMemo } from 'react'
import { KatexExpression } from './katex-expression'
import { parseMathDelimitedText } from './math-plain-text-utils'

export type MathPlainTextProps = {
  text: string
  className?: string
  /** Applied to each text segment (e.g. whitespace-pre-wrap). */
  textClassName?: string
}

/**
 * Renders prose + inline/display LaTeX for quiz stems, choices, and other plain strings.
 */
export function MathPlainText({ text, className, textClassName }: MathPlainTextProps) {
  const segments = useMemo(() => parseMathDelimitedText(text), [text])

  return (
    <span className={className}>
      {segments.map((seg, idx) => {
        if (seg.kind === 'text') {
          return (
            <span key={idx} className={textClassName ?? 'whitespace-pre-wrap'}>
              {seg.text}
            </span>
          )
        }
        if (seg.kind === 'display') {
          return <KatexExpression key={idx} latex={seg.latex} displayMode />
        }
        return <KatexExpression key={idx} latex={seg.latex} displayMode={false} />
      })}
    </span>
  )
}
