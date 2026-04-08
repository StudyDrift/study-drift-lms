import { Markdown } from '@tiptap/markdown'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useEffect, useRef } from 'react'
import type { Editor } from '@tiptap/core'

const editorShellClass = [
  'tiptap',
  'min-h-[100px] w-full px-0 py-1 text-[15px] leading-[1.65] text-slate-800',
  'focus:outline-none',
  '[&_p]:mt-3 [&_p:first-child]:mt-0',
  '[&_h1]:mt-6 [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:text-slate-900 [&_h1]:first:mt-0',
  '[&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-slate-900 [&_h2]:first:mt-0',
  '[&_h3]:mt-6 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-slate-900 [&_h3]:first:mt-0',
  '[&_h4]:mt-4 [&_h4]:text-base [&_h4]:font-semibold [&_h4]:text-slate-900',
  '[&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:text-slate-700',
  '[&_ol]:mt-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:text-slate-700',
  '[&_li]:marker:text-slate-500',
  '[&_a]:font-medium [&_a]:text-indigo-600 [&_a]:underline [&_a]:decoration-indigo-200 [&_a]:underline-offset-2',
  '[&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px]',
  '[&_pre]:mt-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-slate-900 [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-[13px] [&_pre]:text-slate-100',
  '[&_blockquote]:mt-3 [&_blockquote]:border-l-4 [&_blockquote]:border-slate-300 [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-slate-600',
].join(' ')

export type MarkdownBodyEditorProps = {
  sectionId: string
  value: string
  onChange: (markdown: string) => void
  disabled?: boolean
  placeholder?: string
  onFocus?: () => void
  onBlur?: (e: FocusEvent) => void
  /** Register TipTap editor for floating toolbar commands; cleared on unmount. */
  onEditorChange?: (sectionId: string, editor: Editor | null) => void
}

/**
 * WYSIWYG Markdown body: stores Markdown on the wire, renders formatted content while editing.
 */
export function MarkdownBodyEditor({
  sectionId,
  value,
  onChange,
  disabled,
  placeholder,
  onFocus,
  onBlur,
  onEditorChange,
}: MarkdownBodyEditorProps) {
  const skipEmit = useRef(false)
  const onChangeRef = useRef(onChange)
  const onFocusRef = useRef(onFocus)
  const onBlurRef = useRef(onBlur)
  const onEditorChangeRef = useRef(onEditorChange)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])
  useEffect(() => {
    onFocusRef.current = onFocus
  }, [onFocus])
  useEffect(() => {
    onBlurRef.current = onBlur
  }, [onBlur])
  useEffect(() => {
    onEditorChangeRef.current = onEditorChange
  }, [onEditorChange])

  const editor = useEditor(
    {
      immediatelyRender: false,
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3, 4, 5, 6] },
        }),
        Markdown.configure({ markedOptions: { gfm: true } }),
        Link.configure({
          openOnClick: false,
          autolink: true,
          HTMLAttributes: {
            class:
              'font-medium text-indigo-600 underline decoration-indigo-200 underline-offset-2 hover:text-indigo-500',
          },
        }),
        Placeholder.configure({
          placeholder: placeholder ?? 'Start writing…',
          emptyEditorClass: 'is-editor-empty',
        }),
      ],
      content: value ?? '',
      contentType: 'markdown',
      editable: !disabled,
      editorProps: {
        attributes: {
          class: editorShellClass,
          'aria-label': placeholder ?? 'Markdown content',
        },
      },
      onUpdate: ({ editor: ed }) => {
        if (skipEmit.current) {
          skipEmit.current = false
          return
        }
        onChangeRef.current(ed.getMarkdown())
      },
      onFocus: () => onFocusRef.current?.(),
      onBlur: ({ event }) => onBlurRef.current?.(event as FocusEvent),
    },
    [],
  )

  useEffect(() => {
    if (editor) editor.setEditable(!disabled)
  }, [disabled, editor])

  useEffect(() => {
    if (!editor) return
    const cur = editor.getMarkdown()
    if (cur === value) return
    skipEmit.current = true
    editor.commands.setContent(value, { contentType: 'markdown' })
  }, [value, editor])

  useEffect(() => {
    const ref = onEditorChangeRef.current
    ref?.(sectionId, editor)
    return () => {
      ref?.(sectionId, null)
    }
  }, [editor, sectionId])

  if (!editor) {
    return (
      <div
        className="min-h-[100px] w-full rounded-sm bg-slate-50/80"
        aria-busy="true"
        aria-label={placeholder ?? 'Loading editor'}
      />
    )
  }

  return <EditorContent editor={editor} className="w-full [&_.ProseMirror]:min-h-[100px]" />
}
