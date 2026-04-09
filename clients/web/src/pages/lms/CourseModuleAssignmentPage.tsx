import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Pencil } from 'lucide-react'
import { SyllabusBlockEditor } from '../../components/syllabus/SyllabusBlockEditor'
import { MarkdownArticleView } from '../../components/syllabus/SyllabusMarkdownView'
import { markdownToSectionsForEditor, sectionsToMarkdown } from '../../components/syllabus/syllabusSectionMarkdown'
import { usePermissions } from '../../context/usePermissions'
import {
  fetchCourse,
  fetchModuleAssignment,
  patchModuleAssignment,
  type SyllabusSection,
} from '../../lib/coursesApi'
import {
  type MarkdownThemeCustom,
  type ResolvedMarkdownTheme,
  resolveMarkdownTheme,
} from '../../lib/markdownTheme'
import { useLmsDarkMode } from '../../hooks/useLmsDarkMode'
import { permCourseItemCreate } from '../../lib/rbacApi'
import { LmsPage } from './LmsPage'

function isoToDatetimeLocalValue(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function datetimeLocalValueToIso(value: string): string | null {
  const t = value.trim()
  if (!t) return null
  const d = new Date(t)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

function newLocalId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export default function CourseModuleAssignmentPage() {
  const { courseCode, itemId } = useParams<{ courseCode: string; itemId: string }>()
  const { allows, loading: permLoading } = usePermissions()

  const [title, setTitle] = useState('')
  const [markdown, setMarkdown] = useState('')
  const [dueAt, setDueAt] = useState<string | null>(null)
  const [draftDueLocal, setDraftDueLocal] = useState('')
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

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

  const canEdit = Boolean(
    courseCode && itemId && !permLoading && allows(permCourseItemCreate(courseCode)),
  )

  const load = useCallback(async () => {
    if (!courseCode || !itemId) return
    setLoading(true)
    setLoadError(null)
    try {
      const [data, courseRow] = await Promise.all([
        fetchModuleAssignment(courseCode, itemId),
        fetchCourse(courseCode),
      ])
      setTitle(data.title)
      setMarkdown(data.markdown)
      setDueAt(data.dueAt)
      setUpdatedAt(data.updatedAt)
      setMdPreset(courseRow.markdownThemePreset)
      setMdCustom(courseRow.markdownThemeCustom)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load this assignment.')
      setTitle('')
      setMarkdown('')
      setDueAt(null)
      setUpdatedAt(null)
    } finally {
      setLoading(false)
    }
  }, [courseCode, itemId])

  useEffect(() => {
    void load()
  }, [load])

  function beginEdit() {
    setSaveError(null)
    setDraft(markdownToSectionsForEditor(markdown, newLocalId))
    setDraftDueLocal(isoToDatetimeLocalValue(dueAt))
    setEditing(true)
  }

  function cancelEdit() {
    setSaveError(null)
    setEditing(false)
    setDraft([])
    setDraftDueLocal('')
  }

  async function save() {
    if (!courseCode || !itemId) return
    const body = sectionsToMarkdown(draft)
    setSaveError(null)
    setSaving(true)
    try {
      const data = await patchModuleAssignment(courseCode, itemId, {
        markdown: body,
        dueAt: datetimeLocalValueToIso(draftDueLocal),
      })
      setMarkdown(data.markdown)
      setDueAt(data.dueAt)
      setUpdatedAt(data.updatedAt)
      setEditing(false)
      setDraft([])
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not save.')
    } finally {
      setSaving(false)
    }
  }

  if (!courseCode || !itemId) {
    return (
      <LmsPage title="Assignment" description="">
        <p className="mt-6 text-sm text-slate-500">Invalid link.</p>
      </LmsPage>
    )
  }

  const description =
    updatedAt == null
      ? `Course ${courseCode}`
      : `Course ${courseCode} · Updated ${new Date(updatedAt).toLocaleString(undefined, {
          dateStyle: 'medium',
          timeStyle: 'short',
        })}`

  const backTo = `/courses/${encodeURIComponent(courseCode)}/modules`

  return (
    <LmsPage
      title={loading ? 'Assignment' : title || 'Assignment'}
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
            {dueAt && (
              <p className="text-sm text-slate-600">
                <span className="font-medium text-slate-800">Due:</span>{' '}
                {new Date(dueAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
              </p>
            )}
            <MarkdownArticleView
              markdown={markdown}
              emptyMessage="No instructions yet. Select Edit to add Markdown."
              theme={mdTheme}
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
          {canEdit && (
            <div className="mb-4 px-4 md:px-8">
              <label className="block text-sm font-medium text-slate-800 dark:text-slate-200" htmlFor="assignment-due-at">
                Due date (optional)
              </label>
              <input
                id="assignment-due-at"
                type="datetime-local"
                value={draftDueLocal}
                onChange={(e) => setDraftDueLocal(e.target.value)}
                disabled={saving}
                className="mt-2 w-full max-w-md rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-indigo-500"
              />
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Shown on the course calendar. Clear the field to remove.
              </p>
            </div>
          )}
          <div className="px-4 md:px-8">
            <SyllabusBlockEditor
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
