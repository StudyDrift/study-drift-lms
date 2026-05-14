/* eslint-disable react-hooks/set-state-in-effect -- sync localStorage notebook on load */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ConfirmDialog } from '../../components/confirm-dialog'
import { ReadingFocusToggle } from '../../components/layout/reading-focus-toggle'
import { MarkdownBodyEditor } from '../../components/editor/block-editor/markdown-body-editor'
import { CourseNotebookSidebar } from '../../components/notebook/course-notebook-sidebar'
import {
  addNotebookPage,
  deleteNotebookPage,
  updatePageContent,
  updatePageTitle,
  type CourseNotebookPage,
} from '../../lib/course-notebook-tree'
import {
  GLOBAL_STUDENT_NOTEBOOK_KEY,
  GLOBAL_STUDENT_NOTEBOOK_TITLE,
  loadCourseNotebook,
  saveCourseNotebookStore,
  type CourseNotebookStore,
} from '../../lib/student-notebook-storage'
import { LmsPage } from './lms-page'

const CONTENT_SAVE_MS = 500

export default function GlobalNotebookPage() {
  const [data, setData] = useState<CourseNotebookStore | null>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deletePageId, setDeletePageId] = useState<string | null>(null)
  const [deleteTyped, setDeleteTyped] = useState('')
  const [headerTitleDraft, setHeaderTitleDraft] = useState('')
  const contentSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dataRef = useRef<CourseNotebookStore | null>(null)

  useEffect(() => {
    dataRef.current = data
  }, [data])

  const persistStore = useCallback((next: CourseNotebookStore) => {
    saveCourseNotebookStore(GLOBAL_STUDENT_NOTEBOOK_KEY, {
      ...next,
      courseTitle: GLOBAL_STUDENT_NOTEBOOK_TITLE,
    })
  }, [])

  useEffect(() => {
    const loaded = loadCourseNotebook(GLOBAL_STUDENT_NOTEBOOK_KEY)
    setData(loaded)
    const page = loaded.pages.find((p) => p.id === loaded.activePageId)
    setHeaderTitleDraft(page?.title ?? '')
  }, [])

  useEffect(() => {
    return () => {
      if (contentSaveTimer.current) clearTimeout(contentSaveTimer.current)
      const d = dataRef.current
      if (d) persistStore(d)
    }
  }, [persistStore])

  const scheduleContentSave = useCallback(() => {
    if (contentSaveTimer.current) clearTimeout(contentSaveTimer.current)
    contentSaveTimer.current = setTimeout(() => {
      const d = dataRef.current
      if (d) persistStore(d)
      contentSaveTimer.current = null
    }, CONTENT_SAVE_MS)
  }, [persistStore])

  const activePage = data?.pages.find((p) => p.id === data.activePageId) ?? null

  useEffect(() => {
    if (activePage) setHeaderTitleDraft(activePage.title)
  }, [activePage])

  const onSelectPage = useCallback(
    (id: string) => {
      setData((d) => {
        if (!d) return d
        const next = { ...d, activePageId: id }
        persistStore(next)
        return next
      })
    },
    [persistStore],
  )

  const onPagesChange = useCallback(
    (pages: CourseNotebookPage[]) => {
      setData((d) => {
        if (!d) return d
        const next = { ...d, pages }
        persistStore(next)
        return next
      })
    },
    [persistStore],
  )

  const onAddRootPage = useCallback(() => {
    setData((d) => {
      if (!d) return d
      const { pages, newId } = addNotebookPage(d.pages, null, 'Untitled')
      const next = { ...d, pages, activePageId: newId }
      persistStore(next)
      return next
    })
  }, [persistStore])

  const onAddChildPage = useCallback(
    (parentId: string) => {
      setData((d) => {
        if (!d) return d
        const { pages, newId } = addNotebookPage(d.pages, parentId, 'Untitled')
        const next = { ...d, pages, activePageId: newId }
        persistStore(next)
        return next
      })
    },
    [persistStore],
  )

  const onRenamePage = useCallback(
    (pageId: string, title: string) => {
      setData((d) => {
        if (!d) return d
        const pages = updatePageTitle(d.pages, pageId, title)
        const next = { ...d, pages }
        persistStore(next)
        return next
      })
    },
    [persistStore],
  )

  const runDeletePage = useCallback(
    (pageId: string) => {
      const cur = dataRef.current
      if (!cur || cur.pages.length <= 1) return
      setData((d) => {
        if (!d) return d
        const pages = deleteNotebookPage(d.pages, pageId)
        let activePageId = d.activePageId
        if (activePageId === pageId || !pages.some((p) => p.id === activePageId)) {
          activePageId = pages[0]?.id ?? null
        }
        const next = { ...d, pages, activePageId }
        persistStore(next)
        return next
      })
    },
    [persistStore],
  )

  const onDeletePage = useCallback((pageId: string) => {
    const cur = dataRef.current
    if (!cur || cur.pages.length <= 1) return
    setDeletePageId(pageId)
    setDeleteTyped('')
    setDeleteConfirmOpen(true)
  }, [])

  const onEditorChange = useCallback(
    (markdown: string) => {
      setData((d) => {
        if (!d?.activePageId) return d
        const pages = updatePageContent(d.pages, d.activePageId, markdown)
        return { ...d, pages }
      })
      scheduleContentSave()
    },
    [scheduleContentSave],
  )

  const commitHeaderTitle = useCallback(() => {
    const d = dataRef.current
    if (!d?.activePageId) return
    const t = headerTitleDraft.trim() || 'Untitled'
    onRenamePage(d.activePageId, t)
    setHeaderTitleDraft(t)
  }, [headerTitleDraft, onRenamePage])

  if (!data) {
    return (
      <LmsPage title="Global notebook" description="Loading…">
        <p className="mt-6 text-sm text-slate-500 dark:text-neutral-400">Loading notebook…</p>
      </LmsPage>
    )
  }

  return (
    <LmsPage
      title="Global notebook"
      description="Private notes not tied to a single course. Stored on this device for your account."
      actions={<ReadingFocusToggle />}
    >
      <p className="mt-4 max-w-[72ch] text-sm text-slate-600 dark:text-neutral-400">
        Use this space for cross-course ideas, career notes, or anything you do not want to file under
        one class. Course notebooks still live under each course.
      </p>

      <div className="mt-4 flex min-h-[min(560px,calc(100dvh-11rem))] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-950 md:mt-6 md:min-h-[min(640px,calc(100dvh-10rem))]">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
          <CourseNotebookSidebar
            pages={data.pages}
            selectedId={data.activePageId}
            onSelect={onSelectPage}
            onPagesChange={onPagesChange}
            onAddRootPage={onAddRootPage}
            onAddChildPage={onAddChildPage}
            onRenamePage={onRenamePage}
            onDeletePage={onDeletePage}
          />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col border-t border-slate-200 dark:border-neutral-800 md:border-l md:border-t-0">
            {activePage ? (
              <>
                <div className="shrink-0 border-b border-slate-100 px-4 py-3 dark:border-neutral-800/80 md:px-6">
                  <label htmlFor="global-notebook-page-title" className="sr-only">
                    Page title
                  </label>
                  <input
                    id="global-notebook-page-title"
                    value={headerTitleDraft}
                    onChange={(e) => setHeaderTitleDraft(e.target.value)}
                    onBlur={commitHeaderTitle}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        ;(e.target as HTMLInputElement).blur()
                      }
                    }}
                    className="w-full border-0 bg-transparent text-lg font-semibold tracking-tight text-slate-900 outline-none ring-indigo-500/25 placeholder:text-slate-400 focus:ring-2 dark:text-neutral-100 dark:placeholder:text-neutral-500"
                    placeholder="Untitled page"
                  />
                </div>
                <div className="mx-auto min-h-0 w-full max-w-[72ch] flex-1 overflow-y-auto px-4 py-4 text-[1.0625rem] leading-relaxed md:px-6 md:py-5">
                  <MarkdownBodyEditor
                    key={activePage.id}
                    sectionId={activePage.id}
                    value={activePage.contentMd}
                    onChange={onEditorChange}
                    placeholder="Start writing… Headings and lists work here. @ mentions and course image uploads are available in course notebooks."
                  />
                </div>
              </>
            ) : (
              <p className="p-6 text-sm text-slate-500 dark:text-neutral-400">Select a page from the sidebar.</p>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={deleteConfirmOpen}
        title="Delete notebook page?"
        description="This removes the page and every nested page under it. This cannot be undone."
        variant="danger"
        requireTypedPhrase="DELETE"
        typedPhrase={deleteTyped}
        onTypedPhraseChange={setDeleteTyped}
        confirmLabel="Delete pages"
        onClose={() => {
          setDeleteConfirmOpen(false)
          setDeletePageId(null)
          setDeleteTyped('')
        }}
        onConfirm={() => {
          if (deletePageId) runDeletePage(deletePageId)
          setDeleteConfirmOpen(false)
          setDeletePageId(null)
          setDeleteTyped('')
        }}
      />
    </LmsPage>
  )
}
