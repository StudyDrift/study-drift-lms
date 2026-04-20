import { Markdown } from '@tiptap/markdown'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Image as ImageIcon } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import type { EditorView } from '@tiptap/pm/view'
import { fetchCourseStructure, type CourseStructureItem } from '../../../lib/coursesApi'
import { hrefForModuleCourseItem } from '../../../lib/courseItemRefTokens'
import { filterTaggable, kindLabel } from '../../courseItemPromptMention'
import { getBlockMentionRange } from './markdownBodyMention'
import { CourseAwareTipTapImage } from './CourseAwareTipTapImage'
import { MathBlock, MathInline } from '../extensions/mathTipTap'

const editorShellClass = [
  'tiptap',
  'min-h-[100px] w-full px-0 py-1 text-[15px] leading-[1.65] text-slate-800',
  'focus:outline-none',
  '[&_p]:mt-3 [&_p:first-child]:mt-0',
  '[&_h1]:mt-6 [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:text-slate-900 [&_h1]:first:mt-0',
  'dark:[&_h1]:text-neutral-100',
  '[&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-slate-900 [&_h2]:first:mt-0',
  'dark:[&_h2]:text-neutral-100',
  '[&_h3]:mt-6 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-slate-900 [&_h3]:first:mt-0',
  'dark:[&_h3]:text-neutral-100',
  '[&_h4]:mt-4 [&_h4]:text-base [&_h4]:font-semibold [&_h4]:text-slate-900',
  'dark:[&_h4]:text-neutral-100',
  '[&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:text-slate-700',
  'dark:[&_ul]:text-neutral-300',
  '[&_ol]:mt-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:text-slate-700',
  'dark:[&_ol]:text-neutral-300',
  '[&_li]:marker:text-slate-500',
  'dark:[&_li]:marker:text-neutral-500',
  '[&_li]:text-slate-700',
  'dark:[&_li]:text-neutral-300',
  '[&_a]:font-medium [&_a]:text-indigo-600 [&_a]:underline [&_a]:decoration-indigo-200 [&_a]:underline-offset-2',
  '[&_a]:dark:text-neutral-200 [&_a]:dark:decoration-neutral-500/60',
  '[&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px] [&_code]:text-slate-900',
  '[&_code]:dark:bg-neutral-800 [&_code]:dark:text-neutral-100',
  '[&_pre]:mt-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-slate-900 [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-[13px] [&_pre]:text-slate-100',
  '[&_blockquote]:mt-3 [&_blockquote]:border-l-4 [&_blockquote]:border-slate-300 [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-slate-600',
  '[&_blockquote]:dark:border-neutral-600 [&_blockquote]:dark:text-neutral-400',
  '[&_figure]:my-3',
  '[&_.katex]:text-inherit',
  '[&_.lex-math-block-root]:my-2 [&_.lex-math-block-root]:w-full',
  '[&_.katex-error-fallback]:align-middle',
].join(' ')

function sanitizeImageAlt(name: string): string {
  return (name || 'Image').replace(/[[\]]/g, '').slice(0, 200)
}

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
  /** When set, typing @ opens a picker to insert links to module content pages and assignments. */
  courseCode?: string
  /** When set with `courseCode`, clipboard and drag-and-drop images upload and insert at the cursor. */
  uploadCourseImage?: (file: File) => Promise<string>
  /** Compact image control above the editor (e.g. student notebook without a block toolbar). */
  showImagePickerRow?: boolean
}

type MentionUi = {
  from: number
  to: number
  query: string
  left: number
  top: number
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
  courseCode,
  uploadCourseImage,
  showImagePickerRow,
}: MarkdownBodyEditorProps) {
  const skipEmit = useRef(false)
  const onChangeRef = useRef(onChange)
  const onFocusRef = useRef(onFocus)
  const onBlurRef = useRef(onBlur)
  const onEditorChangeRef = useRef(onEditorChange)
  const uploadCourseImageRef = useRef(uploadCourseImage)
  const courseCodeRef = useRef(courseCode)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const editorRefForImages = useRef<Editor | null>(null)
  const disabledRef = useRef(!!disabled)

  const listId = useId()
  const [structure, setStructure] = useState<CourseStructureItem[]>([])
  const [structureLoading, setStructureLoading] = useState(false)
  const [structureError, setStructureError] = useState(false)
  const [mentionUi, setMentionUi] = useState<MentionUi | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)

  const mentionCtxRef = useRef({
    mentionUi: null as MentionUi | null,
    filtered: [] as CourseStructureItem[],
    activeIndex: 0,
  })

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
  useEffect(() => {
    uploadCourseImageRef.current = uploadCourseImage
  }, [uploadCourseImage])
  useEffect(() => {
    courseCodeRef.current = courseCode
  }, [courseCode])
  useEffect(() => {
    disabledRef.current = !!disabled
  }, [disabled])

  const editorPasteDropProps = useMemo(
    () => ({
      handleDOMEvents: {
        dragover: (_view: EditorView, e: Event) => {
          const ev = e as DragEvent
          if (disabledRef.current) return false
          if (!uploadCourseImageRef.current || !courseCodeRef.current) return false
          if (ev.dataTransfer?.types?.includes('Files')) {
            ev.preventDefault()
          }
          return false
        },
      },
      handlePaste(view: EditorView, event: ClipboardEvent) {
        if (disabledRef.current) return false
        const upload = uploadCourseImageRef.current
        const code = courseCodeRef.current
        if (!upload || !code) return false
        const items = event.clipboardData?.items
        if (!items?.length) return false
        const files: File[] = []
        for (let i = 0; i < items.length; i++) {
          const it = items[i]
          if (it?.kind === 'file' && it.type.startsWith('image/')) {
            const f = it.getAsFile()
            if (f) files.push(f)
          }
        }
        if (!files.length) return false
        event.preventDefault()
        const ed = editorRefForImages.current
        if (!ed) return true
        const from = view.state.selection.from
        void (async () => {
          let pos = from
          for (const file of files) {
            try {
              const path = await upload(file)
              ed.chain()
                .focus()
                .insertContentAt(pos, {
                  type: 'image',
                  attrs: { src: path, alt: sanitizeImageAlt(file.name) },
                })
                .run()
              pos = ed.state.selection.to
            } catch {
              /* ignore failed upload */
            }
          }
        })()
        return true
      },
      handleDrop(view: EditorView, event: DragEvent) {
        if (disabledRef.current) return false
        const upload = uploadCourseImageRef.current
        const code = courseCodeRef.current
        if (!upload || !code) return false
        const dt = event.dataTransfer
        if (!dt?.files?.length) return false
        const files = [...dt.files].filter((f) => f.type.startsWith('image/'))
        if (!files.length) return false
        event.preventDefault()
        const ed = editorRefForImages.current
        if (!ed) return true
        const coords = view.posAtCoords({ left: event.clientX, top: event.clientY })
        const pos = coords?.pos ?? view.state.selection.from
        void (async () => {
          let p = pos
          for (const file of files) {
            try {
              const path = await upload(file)
              ed.chain()
                .focus()
                .insertContentAt(p, {
                  type: 'image',
                  attrs: { src: path, alt: sanitizeImageAlt(file.name) },
                })
                .run()
              p = ed.state.selection.to
            } catch {
              /* ignore */
            }
          }
        })()
        return true
      },
    }),
    [],
  )

  useEffect(() => {
    if (!courseCode) return
    let cancelled = false
    setStructureLoading(true)
    setStructureError(false)
    void fetchCourseStructure(courseCode)
      .then((items) => {
        if (!cancelled) setStructure(items)
      })
      .catch(() => {
        if (!cancelled) {
          setStructure([])
          setStructureError(true)
        }
      })
      .finally(() => {
        if (!cancelled) setStructureLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [courseCode])

  const filtered = useMemo(
    () => (mentionUi ? filterTaggable(structure, mentionUi.query) : []),
    [structure, mentionUi],
  )

  useEffect(() => {
    setActiveIndex(0)
  }, [mentionUi?.from, mentionUi?.query])

  useEffect(() => {
    if (filtered.length === 0) return
    setActiveIndex((i) => Math.min(i, filtered.length - 1))
  }, [filtered.length])

  useLayoutEffect(() => {
    mentionCtxRef.current = { mentionUi, filtered, activeIndex }
  })

  const editor = useEditor(
    {
      immediatelyRender: false,
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3, 4, 5, 6] },
        }),
        MathBlock,
        MathInline,
        Markdown.configure({ markedOptions: { gfm: true } }),
        Link.configure({
          openOnClick: false,
          autolink: true,
          HTMLAttributes: {
            class:
              'font-medium text-indigo-600 underline decoration-indigo-200 underline-offset-2 hover:text-indigo-500 dark:text-indigo-400 dark:decoration-indigo-500/50 dark:hover:text-indigo-300',
          },
        }),
        CourseAwareTipTapImage.configure({
          inline: false,
          allowBase64: false,
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
        ...editorPasteDropProps,
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
    editorRefForImages.current = editor
  }, [editor])

  const syncMention = useCallback(() => {
    if (!editor || disabled || !courseCode) {
      setMentionUi(null)
      return
    }
    const r = getBlockMentionRange(editor.state)
    if (!r) {
      setMentionUi(null)
      return
    }
    const coords = editor.view.coordsAtPos(editor.state.selection.from)
    setMentionUi({
      from: r.from,
      to: r.to,
      query: r.query,
      left: coords.left,
      top: coords.bottom + 4,
    })
  }, [editor, disabled, courseCode])

  useEffect(() => {
    if (!editor) return
    editor.on('selectionUpdate', syncMention)
    editor.on('update', syncMention)
    syncMention()
    return () => {
      editor.off('selectionUpdate', syncMention)
      editor.off('update', syncMention)
    }
  }, [editor, syncMention])

  useEffect(() => {
    if (!courseCode) setMentionUi(null)
  }, [courseCode])

  const applyPick = useCallback(
    (item: CourseStructureItem) => {
      if (!editor || !courseCode) return
      const mu = mentionCtxRef.current.mentionUi
      if (!mu) return
      if (item.kind !== 'content_page' && item.kind !== 'assignment') return
      const href = hrefForModuleCourseItem(courseCode, item.kind, item.id)
      editor
        .chain()
        .focus()
        .deleteRange({ from: mu.from, to: mu.to })
        .insertContentAt(mu.from, {
          type: 'text',
          text: item.title,
          marks: [{ type: 'link', attrs: { href } }],
        })
        .run()
      setMentionUi(null)
    },
    [editor, courseCode],
  )

  const cancelMention = useCallback(() => {
    if (!editor) return
    const mu = mentionCtxRef.current.mentionUi
    if (!mu) return
    editor.chain().focus().deleteRange({ from: mu.from, to: mu.to }).run()
    setMentionUi(null)
  }, [editor])

  useEffect(() => {
    if (!editor) return
    const dom = editor.view.dom
    const onKeyDown = (e: KeyboardEvent) => {
      const { mentionUi: mu, filtered: f, activeIndex: ai } = mentionCtxRef.current
      if (!mu || disabled || !courseCode) return
      if (structureLoading) return

      if (f.length === 0) {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          cancelMention()
        }
        return
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        e.stopPropagation()
        setActiveIndex((i) => (i + 1) % f.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopPropagation()
        setActiveIndex((i) => (i - 1 + f.length) % f.length)
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        const item = f[ai]
        if (item) applyPick(item)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        cancelMention()
      }
    }
    dom.addEventListener('keydown', onKeyDown, true)
    return () => dom.removeEventListener('keydown', onKeyDown, true)
  }, [editor, disabled, courseCode, structureLoading, applyPick, cancelMention])

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

  const listOpen = Boolean(mentionUi && !disabled && courseCode)
  const canCourseImageUpload = Boolean(courseCode && uploadCourseImage)

  const onImageInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      e.target.value = ''
      if (!files?.length || !editor || !uploadCourseImage) return
      const from = editor.state.selection.from
      void (async () => {
        let pos = from
        for (const file of [...files]) {
          if (!file.type.startsWith('image/')) continue
          try {
            const path = await uploadCourseImage(file)
            editor
              .chain()
              .focus()
              .insertContentAt(pos, {
                type: 'image',
                attrs: { src: path, alt: sanitizeImageAlt(file.name) },
              })
              .run()
            pos = editor.state.selection.to
          } catch {
            /* ignore */
          }
        }
      })()
    },
    [editor, uploadCourseImage],
  )

  if (!editor) {
    return (
      <div
        className="min-h-[100px] w-full rounded-sm bg-slate-50/80 dark:bg-neutral-900/60"
        aria-busy="true"
        aria-label={placeholder ?? 'Loading editor'}
      />
    )
  }

  return (
    <>
      {showImagePickerRow && canCourseImageUpload ? (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <input
            ref={imageInputRef}
            type="file"
            accept="image/png,image/jpeg,image/jpg,image/gif,image/webp"
            className="sr-only"
            aria-hidden
            tabIndex={-1}
            onChange={onImageInputChange}
          />
          <button
            type="button"
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => imageInputRef.current?.click()}
            onDragOver={(e) => {
              if (disabled) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'copy'
            }}
            onDrop={(e) => {
              if (disabled) return
              e.preventDefault()
              const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'))
              if (!files.length || !editor || !uploadCourseImage) return
              const from = editor.state.selection.from
              void (async () => {
                let pos = from
                for (const file of files) {
                  try {
                    const path = await uploadCourseImage(file)
                    editor
                      .chain()
                      .focus()
                      .insertContentAt(pos, {
                        type: 'image',
                        attrs: { src: path, alt: sanitizeImageAlt(file.name) },
                      })
                      .run()
                    pos = editor.state.selection.to
                  } catch {
                    /* ignore */
                  }
                }
              })()
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
          >
            <ImageIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
            Image
          </button>
          <span className="text-xs text-slate-500 dark:text-neutral-400">
            Drop or paste images in the editor, or pick a file here.
          </span>
        </div>
      ) : null}
      <div className="w-full [&_.ProseMirror]:min-h-[100px]">
        <EditorContent editor={editor} className="w-full" />
      </div>
      {listOpen && mentionUi
        ? createPortal(
            <div
              id={listId}
              role="listbox"
              aria-label="Course items to link"
              style={{
                position: 'fixed',
                left: mentionUi.left,
                top: mentionUi.top,
                zIndex: 60,
                width: 'min(20rem, calc(100vw - 2rem))',
              }}
              className="max-h-56 overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg shadow-slate-900/15 dark:border-neutral-600 dark:bg-neutral-900"
            >
              {structureLoading ? (
                <p className="px-3 py-2 text-sm text-slate-500 dark:text-neutral-400">
                  Loading course items…
                </p>
              ) : structureError ? (
                <p className="px-3 py-2 text-sm text-rose-600 dark:text-rose-400">
                  Could not load course structure.
                </p>
              ) : filtered.length === 0 ? (
                <p className="px-3 py-2 text-sm text-slate-500 dark:text-neutral-400">
                  No matching content pages or assignments. Keep typing to filter.
                </p>
              ) : (
                filtered.map((item, idx) => (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    id={`${listId}-opt-${idx}`}
                    aria-selected={idx === activeIndex}
                    className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm transition ${
                      idx === activeIndex
                        ? 'bg-indigo-50 text-indigo-950 dark:bg-indigo-950/50 dark:text-indigo-50'
                        : 'text-slate-800 hover:bg-slate-50 dark:text-neutral-100 dark:hover:bg-neutral-800'
                    }`}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      applyPick(item)
                    }}
                    onMouseEnter={() => setActiveIndex(idx)}
                  >
                    <span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-neutral-400">
                      {kindLabel(item.kind)}
                    </span>
                    <span className="font-medium">{item.title}</span>
                  </button>
                ))
              )}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
