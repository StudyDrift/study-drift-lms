import type { EditorState } from '@tiptap/pm/state'
import { getMentionState } from '../../course-item-prompt-mention'

/** Collapsed selection in a text block: text from block start to cursor (for @-mention). */
export function getMentionBlockContext(
  state: EditorState,
): { blockStart: number; cursorPos: number; text: string } | null {
  const sel = state.selection
  if (!sel.empty) return null
  const $from = sel.$from
  if (!$from.parent.isTextblock) return null
  const blockStart = $from.start()
  const cursorPos = sel.from
  const text = state.doc.textBetween(blockStart, cursorPos, '\n', '\n')
  return { blockStart, cursorPos, text }
}

/** Active @-query inside the current block, with document positions for replace. */
export function getBlockMentionRange(
  state: EditorState,
): { from: number; to: number; query: string } | null {
  const ctx = getMentionBlockContext(state)
  if (!ctx) return null
  const m = getMentionState(ctx.text, ctx.text.length)
  if (!m) return null
  return {
    from: ctx.blockStart + m.start,
    to: ctx.cursorPos,
    query: m.query,
  }
}
