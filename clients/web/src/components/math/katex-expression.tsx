import { useEffect, useState } from 'react'
import {
  isMathRenderingEnabled,
  loadKatex,
  renderKatexLoadingFallback,
  renderKatexSafe,
  type KatexModule,
} from '../../lib/math'

export type KatexExpressionProps = {
  latex: string
  displayMode: boolean
  className?: string
}

/**
 * Single LaTeX fragment with lazy KaTeX, MathML-capable output, and error fallback.
 */
export function KatexExpression({ latex, displayMode, className }: KatexExpressionProps) {
  const [katex, setKatex] = useState<KatexModule | null>(null)
  const enabled = isMathRenderingEnabled()

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void loadKatex().then((k) => {
      if (!cancelled) setKatex(k)
    })
    return () => {
      cancelled = true
    }
  }, [enabled])

  if (!enabled) {
    return (
      <code
        className={
          className ??
          'rounded bg-slate-100 px-1 font-mono text-[13px] text-slate-800 dark:bg-neutral-800 dark:text-neutral-100'
        }
      >
        {displayMode ? `$$${latex}$$` : `$${latex}$`}
      </code>
    )
  }

  if (!katex) {
    return (
      <span
        className={className}
        dangerouslySetInnerHTML={{ __html: renderKatexLoadingFallback(latex, displayMode) }}
      />
    )
  }

  const { html, failed } = renderKatexSafe(katex, latex, displayMode)
  const wrapperCls = displayMode
    ? `my-1 block w-full overflow-x-auto text-center ${className ?? ''}`
    : `inline-block align-middle ${className ?? ''}`

  return (
    <span
      className={`${wrapperCls} ${failed ? '' : 'katex-wrap'}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
