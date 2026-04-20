import { ChevronDown, ChevronUp } from 'lucide-react'
import { useCallback, useId, useState } from 'react'

const GROUPS = {
  basic: {
    label: 'Basic',
    keys: ['+', '−', '×', '÷', '=', '≠', '<', '>', '≤', '≥', '(', ')', '[', ']'],
  },
  fractions: {
    label: 'Fractions',
    keys: ['\\frac{}{}', '\\dfrac{}{}', '\\tfrac{}{}'],
  },
  exponents: {
    label: 'Powers',
    keys: ['^{}', '_{}', 'x^{2}', 'x^{n}', 'e^{x}', '10^{}'],
  },
  roots: {
    label: 'Roots',
    keys: ['\\sqrt{}', '\\sqrt[]{}', '\\sqrt[3]{}'],
  },
  greek: {
    label: 'Greek',
    keys: [
      '\\pi',
      '\\theta',
      '\\alpha',
      '\\beta',
      '\\gamma',
      '\\delta',
      '\\sigma',
      '\\omega',
      '\\Delta',
      '\\Omega',
      '\\lambda',
      '\\mu',
    ],
  },
  trig: {
    label: 'Trig',
    keys: [
      '\\sin',
      '\\cos',
      '\\tan',
      '\\cot',
      '\\sec',
      '\\csc',
      '\\arcsin',
      '\\arccos',
      '\\arctan',
    ],
  },
} as const

type GroupKey = keyof typeof GROUPS

function caretOffsetAfterInsert(snippet: string): number | undefined {
  if (snippet.startsWith('\\frac{')) return '\\frac{'.length
  if (snippet.startsWith('\\dfrac{')) return '\\dfrac{'.length
  if (snippet.startsWith('\\tfrac{')) return '\\tfrac{'.length
  if (snippet === '\\sqrt{}') return '\\sqrt{'.length
  if (snippet === '\\sqrt[]{}') return '\\sqrt['.length
  if (snippet === '^{}') return '^{'.length
  if (snippet === '_{}') return '_{'.length
  if (snippet === '10^{}') return '10^{'.length
  return undefined
}

export type MathKeyboardProps = {
  /** Second arg: caret offset from start of inserted snippet (for \\frac{}{}, etc.). */
  onInsert: (snippet: string, caretOffsetFromStartOfSnippet?: number) => void
  disabled?: boolean
  className?: string
}

/**
 * Symbol groups for short-answer STEM input (collapsible, keyboard navigable).
 */
export function MathKeyboard({ onInsert, disabled, className }: MathKeyboardProps) {
  const baseId = useId()
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState<GroupKey | null>('basic')

  const insert = useCallback(
    (snippet: string) => {
      onInsert(snippet, caretOffsetAfterInsert(snippet))
    },
    [onInsert],
  )

  return (
    <div
      className={[
        'rounded-xl border border-slate-200 bg-slate-50/80 dark:border-neutral-600 dark:bg-neutral-900/60',
        className ?? '',
      ].join(' ')}
    >
      <button
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-controls={`${baseId}-panel`}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium text-slate-700 dark:text-neutral-200"
      >
        <span>Math symbols</span>
        {open ? <ChevronUp className="h-4 w-4 shrink-0" aria-hidden /> : <ChevronDown className="h-4 w-4 shrink-0" aria-hidden />}
      </button>
      {open ? (
        <div id={`${baseId}-panel`} className="border-t border-slate-200 px-2 pb-3 pt-1 dark:border-neutral-600">
          <div className="flex flex-wrap gap-1 border-b border-slate-200 pb-2 dark:border-neutral-600">
            {(Object.keys(GROUPS) as GroupKey[]).map((gk) => (
              <button
                key={gk}
                type="button"
                className={`min-h-[44px] min-w-[44px] rounded-lg px-2 text-[11px] font-medium ${
                  expanded === gk
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white text-slate-700 shadow-sm dark:bg-neutral-800 dark:text-neutral-200'
                }`}
                onClick={() => setExpanded((e) => (e === gk ? null : gk))}
              >
                {GROUPS[gk].label}
              </button>
            ))}
          </div>
          {expanded ? (
            <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label={GROUPS[expanded].label}>
              {GROUPS[expanded].keys.map((sym) => (
                <button
                  key={sym}
                  type="button"
                  disabled={disabled}
                  title={sym}
                  onClick={() => insert(sym)}
                  className="min-h-[44px] min-w-[44px] max-w-[8rem] shrink rounded-lg border border-slate-200 bg-white px-1.5 py-1 font-mono text-[13px] text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700"
                >
                  {sym.length > 14 ? `${sym.slice(0, 14)}…` : sym}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
