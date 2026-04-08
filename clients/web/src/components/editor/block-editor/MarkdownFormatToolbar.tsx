import {
  Bold,
  Braces,
  Code,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
} from 'lucide-react'
import type { MarkdownEditKind } from './markdownInsert'

export type MarkdownFormatToolbarProps = {
  disabled?: boolean
  onApply: (kind: MarkdownEditKind) => void
}

/**
 * Markdown formatting buttons for use inside BlockFloatingToolbar children.
 * Uses mousedown preventDefault so the textarea keeps focus while clicking.
 */
export function MarkdownFormatToolbar({ disabled, onApply }: MarkdownFormatToolbarProps) {
  function preventBlur(e: React.MouseEvent) {
    e.preventDefault()
  }

  return (
    <>
      <span className="mx-0.5 h-5 w-px shrink-0 bg-slate-200" aria-hidden />
      <button
        type="button"
        disabled={disabled}
        onMouseDown={preventBlur}
        onClick={() => onApply('bulletList')}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="Bullet list"
        title="Bullet list"
      >
        <List className="h-4 w-4" />
      </button>
      <button
        type="button"
        disabled={disabled}
        onMouseDown={preventBlur}
        onClick={() => onApply('orderedList')}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="Numbered list"
        title="Numbered list"
      >
        <ListOrdered className="h-4 w-4" />
      </button>
      <button
        type="button"
        disabled={disabled}
        onMouseDown={preventBlur}
        onClick={() => onApply('bold')}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded font-bold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="Bold"
        title="Bold"
      >
        <Bold className="h-4 w-4" />
      </button>
      <button
        type="button"
        disabled={disabled}
        onMouseDown={preventBlur}
        onClick={() => onApply('italic')}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="Italic"
        title="Italic"
      >
        <Italic className="h-4 w-4" />
      </button>
      <button
        type="button"
        disabled={disabled}
        onMouseDown={preventBlur}
        onClick={() => onApply('inlineCode')}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="Inline code"
        title="Inline code"
      >
        <Code className="h-4 w-4" />
      </button>
      <button
        type="button"
        disabled={disabled}
        onMouseDown={preventBlur}
        onClick={() => onApply('codeBlock')}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="Code block"
        title="Code block"
      >
        <Braces className="h-4 w-4" />
      </button>
      <button
        type="button"
        disabled={disabled}
        onMouseDown={preventBlur}
        onClick={() => onApply('link')}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="Link"
        title="Link"
      >
        <LinkIcon className="h-4 w-4" />
      </button>
    </>
  )
}
