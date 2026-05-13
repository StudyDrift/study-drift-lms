import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useEffect } from 'react'

const editorClass =
  'prose prose-slate dark:prose-invert max-w-none min-h-[120px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900'

export function DiscussionReadonlyBody({ docJson }: { docJson: unknown }) {
  const editor = useEditor({
    extensions: [StarterKit, Link.configure({ openOnClick: true })],
    editable: false,
    content: docJson as Record<string, unknown>,
    editorProps: {
      attributes: {
        class: editorClass,
      },
    },
  })
  useEffect(() => {
    if (!editor) return
    try {
      editor.commands.setContent(docJson as Record<string, unknown>, { emitUpdate: false })
    } catch {
      editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] }, { emitUpdate: false })
    }
  }, [editor, docJson])
  if (!editor) return null
  return <EditorContent editor={editor} />
}

type DiscussionDocEditorProps = {
  value: unknown
  onChange: (doc: Record<string, unknown>) => void
  disabled?: boolean
  placeholder?: string
}

export function DiscussionDocEditor({
  value,
  onChange,
  disabled,
  placeholder,
}: DiscussionDocEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: placeholder ?? 'Write something…' }),
    ],
    editable: !disabled,
    content: value as Record<string, unknown>,
    onUpdate: ({ editor: ed }) => {
      onChange(ed.getJSON() as Record<string, unknown>)
    },
    editorProps: {
      attributes: {
        class: editorClass,
      },
    },
  })
  useEffect(() => {
    if (!editor || disabled === undefined) return
    editor.setEditable(!disabled)
  }, [editor, disabled])
  useEffect(() => {
    if (!editor) return
    const cur = JSON.stringify(editor.getJSON())
    const next = JSON.stringify(value)
    if (cur !== next) {
      try {
        editor.commands.setContent(value as Record<string, unknown>, { emitUpdate: false })
      } catch {
        /* keep existing */
      }
    }
  }, [editor, value])
  if (!editor) return null
  return <EditorContent editor={editor} />
}
