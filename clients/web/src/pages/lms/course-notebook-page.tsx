/* eslint-disable react-hooks/set-state-in-effect -- sync localStorage notebook and course title from network */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { useCourseNavFeatures } from '../../context/course-nav-features-context'
import { MarkdownBodyEditor } from '../../components/editor/block-editor/markdown-body-editor'
import { CourseNotebookSidebar } from '../../components/notebook/course-notebook-sidebar'
import {
  addNotebookPage,
  deleteNotebookPage,
  updatePageContent,
  updatePageTitle,
  type CourseNotebookPage,
} from '../../lib/course-notebook-tree'
import { fetchCourse, uploadCourseFile } from '../../lib/courses-api'
import {
  loadCourseNotebook,
  saveCourseNotebookStore,
  type CourseNotebookStore,
} from '../../lib/student-notebook-storage'
import { LmsPage } from './lms-page'

const CONTENT_SAVE_MS = 500

export default function CourseNotebookPage() {
  const { courseCode } = useParams<{ courseCode: string }>()
  const { notebookEnabled: courseNotebookEnabled, loading: courseFeatureFlagsLoading } =
    useCourseNavFeatures()
  const [data, setData] = useState<CourseNotebookStore | null>(null)
  const [courseTitle, setCourseTitle] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [headerTitleDraft, setHeaderTitleDraft] = useState('')
  const contentSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dataRef = useRef<CourseNotebookStore | null>(null)
  const courseTitleRef = useRef<string | null>(null)

  useEffect(() => {
    dataRef.current = data
  }, [data])
  useEffect(() => {
    courseTitleRef.current = courseTitle
  }, [courseTitle])

  const persistStore = useCallback(
    (next: CourseNotebookStore) => {
      if (!courseCode) return
      saveCourseNotebookStore(courseCode, {
        ...next,
        courseTitle: courseTitleRef.current ?? next.courseTitle,
      })
    },
    [courseCode],
  )

  useEffect(() => {
    if (!courseCode) return
    const loaded = loadCourseNotebook(courseCode)
    setData(loaded)
    const page = loaded.pages.find((p) => p.id === loaded.activePageId)
    setHeaderTitleDraft(page?.title ?? '')
  }, [courseCode])

  useEffect(() => {
    if (!courseCode) return
    let cancelled = false
    setLoadError(null)
    void (async () => {
      try {
        const c = await fetchCourse(courseCode)
        if (!cancelled) {
          setCourseTitle(c.title)
          setData((d) => {
            if (!d) return d
            const next = { ...d, courseTitle: c.title }
            saveCourseNotebookStore(courseCode, next)
            return next
          })
        }
      } catch (e) {
        if (!cancelled) {
          setCourseTitle(null)
          setLoadError(e instanceof Error ? e.message : 'Could not load course.')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [courseCode])

  useEffect(() => {
    return () => {
      if (contentSaveTimer.current) clearTimeout(contentSaveTimer.current)
      const d = dataRef.current
      if (courseCode && d) persistStore(d)
    }
  }, [courseCode, persistStore])

  const scheduleContentSave = useCallback(() => {
    if (contentSaveTimer.current) clearTimeout(contentSaveTimer.current)
    contentSaveTimer.current = setTimeout(() => {
      const d = dataRef.current
      if (d && courseCode) persistStore(d)
      contentSaveTimer.current = null
    }, CONTENT_SAVE_MS)
  }, [courseCode, persistStore])

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

  const onDeletePage = useCallback(
    (pageId: string) => {
      const cur = dataRef.current
      if (!cur || cur.pages.length <= 1) return
      if (!window.confirm('Delete this page and everything nested under it?')) return
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

  if (!courseCode) {
    return <Navigate to="/courses" replace />
  }

  if (!courseFeatureFlagsLoading && !courseNotebookEnabled) {
    return <Navigate to={`/courses/${encodeURIComponent(courseCode)}`} replace />
  }

  if (!data) {
    return (
      <LmsPage title="Notebook" description="Loading…">
        <p className="mt-6 text-sm text-slate-500 dark:text-neutral-400">Loading notebook…</p>
      </LmsPage>
    )
  }

  const pageTitle = courseTitle ? `Notebook — ${courseTitle}` : 'Notebook'

  return (
    <LmsPage
      title={pageTitle}
      description="Private pages and notes for this course. Stored on this device for your account."
    >
      {loadError && (
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
          {loadError} You can still edit your notebook.
        </p>
      )}

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
                  <label htmlFor="notebook-page-title" className="sr-only">
                    Page title
                  </label>
                  <input
                    id="notebook-page-title"
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
                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-5">
                  <MarkdownBodyEditor
                    key={activePage.id}
                    sectionId={activePage.id}
                    value={activePage.contentMd}
                    onChange={onEditorChange}
                    courseCode={courseCode}
                    uploadCourseImage={(file) =>
                      uploadCourseFile(courseCode, file).then((r) => r.contentPath)
                    }
                    showImagePickerRow
                    placeholder="Start writing… Headings, lists, and @ mentions work here."
                  />
                </div>
              </>
            ) : (
              <p className="p-6 text-sm text-slate-500 dark:text-neutral-400">Select a page from the sidebar.</p>
            )}
          </div>
        </div>
      </div>
    </LmsPage>
  )
}
