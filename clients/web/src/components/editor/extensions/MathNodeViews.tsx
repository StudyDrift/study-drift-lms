import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { KatexExpression } from '../../math/KatexExpression'

export function MathInlineNodeView(props: NodeViewProps) {
  const latex = String(props.node.attrs.latex ?? '')
  return (
    <NodeViewWrapper as="span" className="inline" contentEditable={false} data-math-inline="">
      <KatexExpression latex={latex} displayMode={false} />
    </NodeViewWrapper>
  )
}

export function MathBlockNodeView(props: NodeViewProps) {
  const latex = String(props.node.attrs.latex ?? '')
  return (
    <NodeViewWrapper as="div" className="lex-math-block-root" contentEditable={false} data-math-block="">
      <KatexExpression latex={latex} displayMode />
    </NodeViewWrapper>
  )
}
