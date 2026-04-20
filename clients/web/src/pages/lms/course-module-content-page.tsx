import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Pencil } from 'lucide-react'
import { SyllabusBlockEditor } from '../../components/syllabus/syllabus-block-editor'
import { ContentPageReader } from '../../components/content-page/content-page-reader'
import {
  fetchContentPageMarkups,
  type ContentPageMarkup,
} from '../../lib/courses-api'
import { markdownToSectionsForEditor, sectionsToMarkdown } from '../../components/syllabus/syllabus-section-markdown'
import { usePermissions } from '../../context/use-permissions'
import {
  fetchCourse,
  fetchModuleContentPage,
  patchModuleContentPage,
  postCourseContext,
  type SyllabusSection,
} from '../../lib/courses-api'
import {
  type MarkdownThemeCustom,
  type ResolvedMarkdownTheme,
  resolveMarkdownTheme,
} from '../../lib/markdown-theme'
import { useLmsDarkMode } from '../../hooks/use-lms-dark-mode'
import { permCourseItemCreate } from '../../lib/rbac-api'
import { LmsPage } from './lms-page'

function newLocalId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export default function CourseModuleContentPage() {
  const { courseCode, itemId } = useParams<{ courseCode: string; itemId: string }>()
  const { allows, loading: permLoading } = usePermissions()

  const [title, setTitle] = useState('')
  const [markdown, setMarkdown] = useState('')
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [markups, setMarkups] = useState<ContentPageMarkup[]>([])

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<SyllabusSection[]>([])
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [mdPreset, setMdPreset] = useState<string>('classic')
  const [mdCustom, setMdCustom] = useState<MarkdownThemeCustom | null>(null)
  const lmsUiDark = useLmsDarkMode()
  const mdTheme = useMemo(
    (): ResolvedMarkdownTheme => resolveMarkdownTheme(mdPreset, mdCustom, { lmsUiDark }),
    [mdPreset, mdCustom, lmsUiDark],
  )

  const contentLeaveSentRef = useRef(false)
  const contentOpenSentForRef = useRef<string | null>(null)

  const canEdit = Boolean(
    courseCode && itemId && !permLoading && allows(permCourseItemCreate(courseCode)),
  )

  const loadMarkups = useCallback(async () => {
    if (!courseCode || !itemId) return
    try {
      const list = await fetchContentPageMarkups(courseCode, itemId)
      setMarkups(list)
    } catch {
      setMarkups([])
    }
  }, [courseCode, itemId])

  const load = useCallback(async () => {
    if (!courseCode || !itemId) return
    setLoading(true)
    setLoadError(null)
    try {
      const [data, courseRow] = await Promise.all([
        fetchModuleContentPage(courseCode, itemId),
        fetchCourse(courseCode),
      ])
      setTitle(data.title)
      setMarkdown(data.markdown)
      setUpdatedAt(data.updatedAt)
      setMdPreset(courseRow.markdownThemePreset)
      setMdCustom(courseRow.markdownThemeCustom)
      void loadMarkups()
      const openKey = `${courseCode}:${itemId}`
      if (contentOpenSentForRef.current !== openKey) {
        contentOpenSentForRef.current = openKey
        void postCourseContext(courseCode, {
          kind: 'content_open',
          structureItemId: itemId,
        }).catch(() => {})
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load this page.')
      setTitle('')
      setMarkdown('')
      setUpdatedAt(null)
    } finally {
      setLoading(false)
    }
  }, [courseCode, itemId, loadMarkups])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!courseCode || !itemId) return
    contentLeaveSentRef.current = false
    const sendLeave = (keepalive: boolean) => {
      if (contentLeaveSentRef.current) return
      contentLeaveSentRef.current = true
      void postCourseContext(
        courseCode,
        { kind: 'content_leave', structureItemId: itemId },
        { keepalive },
      ).catch(() => {})
    }
    const onPageHide = () => sendLeave(true)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
      sendLeave(false)
      const openKey = `${courseCode}:${itemId}`
      if (contentOpenSentForRef.current === openKey) {
        contentOpenSentForRef.current = null
      }
    }
  }, [courseCode, itemId])

  function beginEdit() {
    setSaveError(null)
    setDraft(markdownToSectionsForEditor(markdown, newLocalId))
    setEditing(true)
  }

  function cancelEdit() {
    setSaveError(null)
    setEditing(false)
    setDraft([])
  }

  async function save() {
    if (!courseCode || !itemId) return
    const body = sectionsToMarkdown(draft)
    setSaveError(null)
    setSaving(true)
    try {
      const data = await patchModuleContentPage(courseCode, itemId, {
        markdown: body,
        dueAt: null,
      })
      setMarkdown(data.markdown)
      setUpdatedAt(data.updatedAt)
      setEditing(false)
      setDraft([])
      void loadMarkups()
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not save.')
    } finally {
      setSaving(false)
    }
  }

  if (!courseCode || !itemId) {
    return (
      <LmsPage title="Content page" description="">
        <p className="mt-6 text-sm text-slate-500">Invalid link.</p>
      </LmsPage>
    )
  }

  const description =
    updatedAt == null
      ? ''
      : `Updated ${new Date(updatedAt).toLocaleString(undefined, {
          dateStyle: 'medium',
          timeStyle: 'short',
        })}`

  const backTo = `/courses/${encodeURIComponent(courseCode)}/modules`

  return (
    <LmsPage
      title={loading ? 'Content page' : title || 'Content page'}
      description={description}
      actions={
        editing ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={cancelEdit}
              disabled={saving}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        ) : canEdit ? (
          <button
            type="button"
            onClick={beginEdit}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Pencil className="h-4 w-4" aria-hidden />
            Edit
          </button>
        ) : null
      }
    >
      <p className="mt-2 text-left text-sm">
        <Link to={backTo} className="font-medium text-indigo-600 hover:text-indigo-500">
          ← Back to modules
        </Link>
      </p>

      <div className="mx-auto w-full max-w-4xl min-w-0">
        {loadError && (
          <p className="mt-6 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {loadError}
          </p>
        )}
        {loading && <p className="mt-8 text-sm text-slate-500">Loading…</p>}

        {!loading && !loadError && !editing && (
          <div className="mt-8 space-y-6">
            <ContentPageReader
              markdown={markdown}
              theme={mdTheme}
              markups={markups}
              onMarkupsChange={loadMarkups}
              courseCode={courseCode}
              markupTarget={{ variant: 'content_page', itemId }}
              contentTitle={title || 'Content page'}
            />
          </div>
        )}
      </div>

      {!loading && !loadError && editing && (
        <div className="mt-6 -mx-6 md:-mx-8">
          {saveError && (
            <p className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-6 py-3 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-200 md:px-8">
              {saveError}
            </p>
          )}
          <div className="px-4 md:px-8">
            <SyllabusBlockEditor
              courseCode={courseCode}
              sections={draft}
              onChange={setDraft}
              disabled={saving}
              documentVariant="page"
            />
          </div>
        </div>
      )}
    </LmsPage>
  )
}
