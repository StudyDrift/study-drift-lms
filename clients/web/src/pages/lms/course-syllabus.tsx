import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Pencil } from 'lucide-react'
import { ContentPageReader } from '../../components/content-page/content-page-reader'
import { SyllabusBlockEditor } from '../../components/syllabus/syllabus-block-editor'
import { sectionsToMarkdown } from '../../components/syllabus/syllabus-section-markdown'
import { usePermissions } from '../../context/use-permissions'
import {
  fetchCourse,
  fetchCourseSyllabus,
  fetchReaderMarkups,
  patchCourseSyllabus,
  type ContentPageMarkup,
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

function cloneSections(sections: SyllabusSection[]): SyllabusSection[] {
  return sections.map((s) => ({ ...s }))
}

export default function CourseSyllabus() {
  const { courseCode } = useParams<{ courseCode: string }>()
  const { allows, loading: permLoading } = usePermissions()

  const [sections, setSections] = useState<SyllabusSection[]>([])
  const [requireSyllabusAcceptance, setRequireSyllabusAcceptance] = useState(false)
  const [draft, setDraft] = useState<SyllabusSection[]>([])
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [markups, setMarkups] = useState<ContentPageMarkup[]>([])
  const [mdPreset, setMdPreset] = useState<string>('classic')
  const [mdCustom, setMdCustom] = useState<MarkdownThemeCustom | null>(null)
  const lmsUiDark = useLmsDarkMode()
  const mdTheme = useMemo(
    (): ResolvedMarkdownTheme => resolveMarkdownTheme(mdPreset, mdCustom, { lmsUiDark }),
    [mdPreset, mdCustom, lmsUiDark],
  )

  const syllabusMarkupTarget = useMemo(() => ({ variant: 'syllabus' as const }), [])

  const syllabusMarkdown = useMemo(() => sectionsToMarkdown(sections), [sections])

  const loadMarkups = useCallback(async () => {
    if (!courseCode) return
    try {
      const list = await fetchReaderMarkups(courseCode, syllabusMarkupTarget)
      setMarkups(list)
    } catch {
      setMarkups([])
    }
  }, [courseCode, syllabusMarkupTarget])

  const canEdit = Boolean(
    courseCode && !permLoading && allows(permCourseItemCreate(courseCode)),
  )

  const load = useCallback(async () => {
    if (!courseCode) return
    setLoading(true)
    setLoadError(null)
    try {
      const [data, courseRow] = await Promise.all([
        fetchCourseSyllabus(courseCode),
        fetchCourse(courseCode),
      ])
      setSections(data.sections)
      setRequireSyllabusAcceptance(Boolean(data.requireSyllabusAcceptance))
      setUpdatedAt(data.updatedAt)
      setMdPreset(courseRow.markdownThemePreset)
      setMdCustom(courseRow.markdownThemeCustom)
      void loadMarkups()
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load the syllabus.')
      setSections([])
      setRequireSyllabusAcceptance(false)
      setUpdatedAt(null)
      setMarkups([])
    } finally {
      setLoading(false)
    }
  }, [courseCode, loadMarkups])

  useEffect(() => {
    void load()
  }, [load])

  function beginEdit() {
    setSaveError(null)
    if (sections.length === 0) {
      setDraft([{ id: newLocalId(), heading: '', markdown: '' }])
    } else {
      setDraft(cloneSections(sections))
    }
    setEditing(true)
  }

  function cancelEdit() {
    setSaveError(null)
    setEditing(false)
    setDraft([])
  }

  async function save() {
    if (!courseCode) return
    setSaveError(null)
    setSaving(true)
    try {
      const data = await patchCourseSyllabus(courseCode, {
        sections: draft,
        requireSyllabusAcceptance,
      })
      setSections(data.sections)
      setRequireSyllabusAcceptance(Boolean(data.requireSyllabusAcceptance))
      setUpdatedAt(data.updatedAt)
      setEditing(false)
      setDraft([])
      void loadMarkups()
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not save the syllabus.')
    } finally {
      setSaving(false)
    }
  }

  if (!courseCode) {
    return (
      <LmsPage title="Syllabus" description="">
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

  return (
    <LmsPage
      title="Syllabus"
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
      {loadError && (
        <p className="mt-6 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-200">
          {loadError}
        </p>
      )}
      {loading && <p className="mt-8 text-sm text-slate-500">Loading syllabus…</p>}

      {!loading && !loadError && !editing && (
        <div className="mx-auto mt-8 w-full max-w-4xl min-w-0 space-y-6">
          {sections.length === 0 && !permLoading && (
            <p className="text-sm text-slate-500">
              {canEdit ? (
                <>
                  No syllabus content yet. Select <span className="font-medium text-slate-700">Edit</span> to add
                  sections.
                </>
              ) : (
                'No syllabus has been published for this course yet.'
              )}
            </p>
          )}
          {sections.length > 0 && (
            <ContentPageReader
              markdown={syllabusMarkdown}
              theme={mdTheme}
              markups={markups}
              onMarkupsChange={loadMarkups}
              courseCode={courseCode}
              markupTarget={syllabusMarkupTarget}
              contentTitle="Syllabus"
            />
          )}
        </div>
      )}

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
              requireSyllabusAcceptance={requireSyllabusAcceptance}
              onRequireSyllabusAcceptanceChange={setRequireSyllabusAcceptance}
            />
          </div>
        </div>
      )}
    </LmsPage>
  )
}
