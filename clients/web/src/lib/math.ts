/**
 * KaTeX helpers: lazy loading, MathML-capable output, and safe fallbacks.
 * See docs/completed/2.3-math-rendering-input.md (feature 2.3).
 */

import type katexType from 'katex'

export type KatexModule = typeof katexType

let katexLoadPromise: Promise<KatexModule> | null = null
let katexCssLoaded = false

/** When false, math nodes render as raw LaTeX only (TipTap still stores nodes). */
export function isMathRenderingEnabled(): boolean {
  const v = import.meta.env.VITE_MATH_RENDERING_ENABLED
  if (v === 'false' || v === '0') return false
  return true
}

export function reportMathRenderError(latex: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err)
  if (import.meta.env.DEV) {
    console.warn('[math] KaTeX render issue', { latex, msg })
  }
}

/**
 * Loads KaTeX and its stylesheet once. Safe to call from multiple components.
 */
export function loadKatex(): Promise<KatexModule> {
  if (!katexLoadPromise) {
    katexLoadPromise = import('katex').then(async (mod) => {
      if (!katexCssLoaded && typeof document !== 'undefined') {
        katexCssLoaded = true
        await import('katex/dist/katex.min.css')
      }
      return mod.default
    })
  }
  return katexLoadPromise
}

export type KatexSafeResult = {
  html: string
  failed: boolean
}

/**
 * Renders LaTeX to HTML (with MathML when supported). On failure, returns a `<code>` fallback (no throw).
 */
export function renderKatexSafe(
  katex: KatexModule,
  latex: string,
  displayMode: boolean,
): KatexSafeResult {
  const trimmed = latex.trim()
  if (!trimmed) {
    return { html: '<code class="katex-fallback" data-math-fallback="empty"></code>', failed: true }
  }
  try {
    const html = katex.renderToString(trimmed, {
      displayMode,
      throwOnError: true,
      output: 'htmlAndMathml',
      strict: 'ignore',
      trust: false,
    })
    return { html, failed: false }
  } catch (e) {
    reportMathRenderError(trimmed, e)
    const escaped = trimmed
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
    return {
      html: `<code class="katex-error-fallback rounded bg-rose-50 px-1 py-0.5 font-mono text-[13px] text-rose-900 dark:bg-rose-950/50 dark:text-rose-100">${escaped}</code>`,
      failed: true,
    }
  }
}

/** Progressive enhancement: plain text until KaTeX loads. */
export function renderKatexLoadingFallback(latex: string, displayMode: boolean): string {
  const escaped = latex
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  const cls = displayMode ? 'block my-2' : 'inline'
  return `<span class="math-latex-pending font-mono text-[13px] text-slate-600 dark:text-neutral-400 ${cls}" data-math-pending="1">${escaped}</span>`
}
