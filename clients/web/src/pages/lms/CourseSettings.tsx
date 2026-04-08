import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { Link, Navigate, useLocation, useParams } from 'react-router-dom'
import { Check, ImageIcon, Move, Save, X } from 'lucide-react'
import { LmsPage } from './LmsPage'
import { authorizedFetch } from '../../lib/api'
import { readApiErrorMessage } from '../../lib/errors'
import { patchCourseMarkdownTheme } from '../../lib/coursesApi'
import type { Course } from './Courses'
import {
  MARKDOWN_THEME_PRESET_META,
  markdownThemeCustomSeed,
  type MarkdownThemeCustom,
  type MarkdownThemePresetId,
} from '../../lib/markdownTheme'
import {
  formatHeroObjectPosition,
  heroImageObjectStyle,
  parseHeroObjectPosition,
} from '../../lib/heroImagePosition'
import { CourseGradingSettingsSection } from './CourseGradingSettings'

function isoToDatetimeLocal(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function datetimeLocalToIso(value: string): string | null {
  const t = value.trim()
  if (!t) return null
  const d = new Date(t)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

function defaultImagePrompt(courseTitle: string, courseDescription: string): string {
  return `Generate an image for a course banner with the following title and description:
Title: ${courseTitle}
Description: ${courseDescription}
`
}

type SavePayload = {
  title: string
  description: string
  published: boolean
  startsAt: string | null
  endsAt: string | null
  visibleFrom: string | null
  hiddenAt: string | null
}

type SettingsSection = 'basic' | 'dates' | 'branding' | 'grading'

function parseSettingsSection(courseCode: string, pathname: string): SettingsSection | 'invalid' {
  const base = `/courses/${encodeURIComponent(courseCode)}/settings`
  if (pathname === base || pathname === `${base}/`) return 'basic'
  if (!pathname.startsWith(`${base}/`)) return 'invalid'
  const rest = pathname.slice(base.length + 1).replace(/\/+$/, '')
  const parts = rest.split('/').filter(Boolean)
  if (parts.length === 0) return 'basic'
  if (parts.length > 1) return 'invalid'
  if (parts[0] === 'dates') return 'dates'
  if (parts[0] === 'branding') return 'branding'
  if (parts[0] === 'grading') return 'grading'
  return 'invalid'
}

export default function CourseSettings() {
  const { courseCode } = useParams<{ courseCode: string }>()
  const location = useLocation()
  const [course, setCourse] = useState<Course | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [published, setPublished] = useState(false)
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [visibleFrom, setVisibleFrom] = useState('')
  const [hiddenAt, setHiddenAt] = useState('')

  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveMessage, setSaveMessage] = useState<string | null>(null)

  const [imageModalOpen, setImageModalOpen] = useState(false)
  const [imagePrompt, setImagePrompt] = useState('')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  /** Generated image URL not yet persisted with Save image */
  const [pendingHeroUrl, setPendingHeroUrl] = useState<string | null>(null)
  const [genStatus, setGenStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [genMessage, setGenMessage] = useState<string | null>(null)
  const [saveHeroStatus, setSaveHeroStatus] = useState<'idle' | 'saving' | 'error'>('idle')

  const [positionModalOpen, setPositionModalOpen] = useState(false)
  const [positionDraft, setPositionDraft] = useState({ x: 50, y: 50 })
  const [positionDragging, setPositionDragging] = useState(false)
  const [positionSaveStatus, setPositionSaveStatus] = useState<'idle' | 'saving' | 'error'>('idle')
  const [positionMessage, setPositionMessage] = useState<string | null>(null)

  const [mdThemeStatus, setMdThemeStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [mdThemeMessage, setMdThemeMessage] = useState<string | null>(null)
  const [customDraft, setCustomDraft] = useState<MarkdownThemeCustom>(markdownThemeCustomSeed)

  const loadCourse = useCallback(async () => {
    if (!courseCode) return
    setLoading(true)
    setLoadError(null)
    try {
      const res = await authorizedFetch(`/api/v1/courses/${encodeURIComponent(courseCode)}`)
      const raw: unknown = await res.json().catch(() => ({}))
      if (!res.ok) {
        setLoadError(readApiErrorMessage(raw))
        return
      }
      const c = raw as Course
      setCourse(c)
      setTitle(c.title)
      setDescription(c.description)
      setPublished(c.published)
      setStartsAt(isoToDatetimeLocal(c.startsAt))
      setEndsAt(isoToDatetimeLocal(c.endsAt))
      setVisibleFrom(isoToDatetimeLocal(c.visibleFrom))
      setHiddenAt(isoToDatetimeLocal(c.hiddenAt))
    } catch {
      setLoadError('Could not load this course.')
    } finally {
      setLoading(false)
    }
  }, [courseCode])

  useEffect(() => {
    void loadCourse()
  }, [loadCourse])

  useEffect(() => {
    if (!course) return
    setCustomDraft({
      ...markdownThemeCustomSeed,
      ...(course.markdownThemeCustom ?? {}),
    })
  }, [course])

  async function selectMarkdownPreset(preset: MarkdownThemePresetId) {
    if (!courseCode) return
    setMdThemeStatus('saving')
    setMdThemeMessage(null)
    try {
      const updated = await patchCourseMarkdownTheme(courseCode, { preset })
      setCourse(updated)
      setMdThemeStatus('saved')
      setMdThemeMessage('Reading theme saved.')
    } catch (e) {
      setMdThemeStatus('error')
      setMdThemeMessage(e instanceof Error ? e.message : 'Could not save theme.')
      void loadCourse()
    }
  }

  async function saveCustomMarkdownTheme() {
    if (!courseCode) return
    setMdThemeStatus('saving')
    setMdThemeMessage(null)
    try {
      const updated = await patchCourseMarkdownTheme(courseCode, {
        preset: 'custom',
        custom: customDraft,
      })
      setCourse(updated)
      setMdThemeStatus('saved')
      setMdThemeMessage('Custom reading theme saved.')
    } catch (e) {
      setMdThemeStatus('error')
      setMdThemeMessage(e instanceof Error ? e.message : 'Could not save theme.')
      void loadCourse()
    }
  }

  function buildPayload(overrides?: Partial<{ published: boolean }>): SavePayload {
    return {
      title: title.trim(),
      description: description.trim(),
      published: overrides?.published ?? published,
      startsAt: datetimeLocalToIso(startsAt),
      endsAt: datetimeLocalToIso(endsAt),
      visibleFrom: datetimeLocalToIso(visibleFrom),
      hiddenAt: datetimeLocalToIso(hiddenAt),
    }
  }

  async function persistCourse(payload: SavePayload) {
    if (!courseCode) return
    setSaveStatus('saving')
    setSaveMessage(null)
    try {
      const res = await authorizedFetch(`/api/v1/courses/${encodeURIComponent(courseCode)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: payload.title,
          description: payload.description,
          published: payload.published,
          startsAt: payload.startsAt,
          endsAt: payload.endsAt,
          visibleFrom: payload.visibleFrom,
          hiddenAt: payload.hiddenAt,
        }),
      })
      const raw: unknown = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSaveStatus('error')
        setSaveMessage(readApiErrorMessage(raw))
        void loadCourse()
        return
      }
      const updated = raw as Course
      setCourse(updated)
      setPublished(updated.published)
      setSaveStatus('saved')
      setSaveMessage('Saved.')
    } catch {
      setSaveStatus('error')
      setSaveMessage('Could not save.')
      void loadCourse()
    }
  }

  async function onSaveForm(e: FormEvent) {
    e.preventDefault()
    const payload = buildPayload()
    if (!payload.title) {
      setSaveStatus('error')
      setSaveMessage('Title is required.')
      return
    }
    await persistCourse(payload)
  }

  async function onPublishedToggle() {
    const next = !published
    setPublished(next)
    await persistCourse(buildPayload({ published: next }))
  }

  const closeImageModal = useCallback(() => {
    setImageModalOpen(false)
    setPendingHeroUrl(null)
    setSaveHeroStatus('idle')
  }, [])

  const closePositionModal = useCallback(() => {
    setPositionModalOpen(false)
    setPositionSaveStatus('idle')
    setPositionMessage(null)
  }, [])

  function openPositionModal() {
    if (!course?.heroImageUrl) return
    setPositionDraft(parseHeroObjectPosition(course.heroImageObjectPosition))
    setPositionDragging(false)
    setPositionSaveStatus('idle')
    setPositionMessage(null)
    setPositionModalOpen(true)
  }

  const setFocalFromClient = useCallback(
    (clientX: number, clientY: number, el: HTMLElement) => {
      const rect = el.getBoundingClientRect()
      const w = rect.width || 1
      const h = rect.height || 1
      const x = Math.round(((clientX - rect.left) / w) * 100)
      const y = Math.round(((clientY - rect.top) / h) * 100)
      setPositionDraft({
        x: Math.min(100, Math.max(0, x)),
        y: Math.min(100, Math.max(0, y)),
      })
    },
    [],
  )

  async function onSaveHeroPosition() {
    if (!courseCode || !course?.heroImageUrl) return
    const isDefault = positionDraft.x === 50 && positionDraft.y === 50
    setPositionSaveStatus('saving')
    setPositionMessage(null)
    try {
      const res = await authorizedFetch(
        `/api/v1/courses/${encodeURIComponent(courseCode)}/hero-image`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            objectPosition: isDefault ? null : formatHeroObjectPosition(positionDraft.x, positionDraft.y),
          }),
        },
      )
      const raw: unknown = await res.json().catch(() => ({}))
      if (!res.ok) {
        setPositionSaveStatus('error')
        setPositionMessage(readApiErrorMessage(raw))
        return
      }
      const updated = raw as Course
      setCourse(updated)
      setPositionSaveStatus('idle')
      setPositionMessage('Banner position saved.')
    } catch {
      setPositionSaveStatus('error')
      setPositionMessage('Could not reach the server.')
    }
  }

  function openImageModal() {
    const t = title.trim() || course?.title || ''
    const d = description || course?.description || ''
    setImagePrompt(defaultImagePrompt(t, d))
    setPreviewUrl(course?.heroImageUrl ?? null)
    setPendingHeroUrl(null)
    setGenMessage(null)
    setGenStatus('idle')
    setSaveHeroStatus('idle')
    setImageModalOpen(true)
  }

  async function onSaveHeroImage() {
    if (!courseCode || !pendingHeroUrl?.trim()) return
    setSaveHeroStatus('saving')
    setGenMessage(null)
    try {
      const res = await authorizedFetch(
        `/api/v1/courses/${encodeURIComponent(courseCode)}/hero-image`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageUrl: pendingHeroUrl }),
        },
      )
      const raw: unknown = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSaveHeroStatus('error')
        setGenMessage(readApiErrorMessage(raw))
        return
      }
      const updated = raw as Course
      setCourse(updated)
      setPreviewUrl(updated.heroImageUrl ?? pendingHeroUrl)
      setPendingHeroUrl(null)
      setSaveHeroStatus('idle')
      setGenMessage('Hero image saved to this course.')
    } catch {
      setSaveHeroStatus('error')
      setGenMessage('Could not reach the server.')
    }
  }

  async function onGenerateInModal(e: FormEvent) {
    e.preventDefault()
    if (!courseCode || !imagePrompt.trim()) return
    setGenStatus('loading')
    setGenMessage(null)
    try {
      const res = await authorizedFetch(
        `/api/v1/courses/${encodeURIComponent(courseCode)}/generate-image`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: imagePrompt.trim() }),
        },
      )
      const raw: unknown = await res.json().catch(() => ({}))
      if (!res.ok) {
        setGenStatus('error')
        setGenMessage(readApiErrorMessage(raw))
        return
      }
      const data = raw as { imageUrl?: string }
      if (data.imageUrl) {
        setPreviewUrl(data.imageUrl)
        setPendingHeroUrl(data.imageUrl)
      }
      setGenStatus('idle')
      setGenMessage('Image ready. Save to apply it as the course hero.')
    } catch {
      setGenStatus('error')
      setGenMessage('Could not reach the server.')
    }
  }

  useEffect(() => {
    if (!imageModalOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closeImageModal()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [imageModalOpen, closeImageModal])

  useEffect(() => {
    if (!positionModalOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closePositionModal()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [positionModalOpen, closePositionModal])

  if (!courseCode) {
    return (
      <LmsPage title="Course settings" description="">
        <p className="mt-6 text-sm text-slate-500">Invalid link.</p>
      </LmsPage>
    )
  }

  const section = parseSettingsSection(courseCode, location.pathname)
  const settingsBase = `/courses/${encodeURIComponent(courseCode)}/settings`
  if (section === 'invalid') {
    return <Navigate to={settingsBase} replace />
  }

  const pageTitle =
    section === 'dates'
      ? course?.title
        ? `${course.title} — dates`
        : 'Dates'
      : section === 'branding'
        ? course?.title
          ? `${course.title} — branding`
          : 'Branding'
        : section === 'grading'
          ? course?.title
            ? `${course.title} — grading`
            : 'Grading'
          : course?.title
            ? `${course.title} — settings`
            : 'Course settings'

  const pageDescription =
    section === 'basic'
      ? 'Title, description, and publishing for this course.'
      : section === 'dates'
        ? 'Schedule and visibility windows for this course.'
        : section === 'grading'
          ? 'Grading scale, weighted assignment groups, and how items map to each group.'
          : 'Hero image, banner, and reading appearance for syllabus and module pages.'

  return (
    <LmsPage title={pageTitle} description={pageDescription}>
      <p className="mt-2">
        <Link
          to={`/courses/${encodeURIComponent(courseCode)}`}
          className="text-sm font-medium text-indigo-600 hover:text-indigo-500"
        >
          ← Back to course
        </Link>
      </p>

      {loading && <p className="mt-6 text-sm text-slate-500">Loading…</p>}
      {loadError && (
        <p className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {loadError}
        </p>
      )}

      {course && !loading && (
        <div
          className={`mt-8 space-y-6 ${section === 'branding' || section === 'grading' ? 'max-w-4xl' : 'max-w-2xl'}`}
        >
          {section === 'basic' && (
            <>
              <form onSubmit={onSaveForm} className="space-y-6">
                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-900/5">
                  <h2 className="text-sm font-semibold text-slate-900">Basic information</h2>
                  <div className="mt-4 space-y-4">
                    <label className="block">
                      <span className="mb-1.5 block text-sm font-medium text-slate-700">Title</span>
                      <input
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        required
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-indigo-500/20 focus:border-indigo-400 focus:ring-2"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-sm font-medium text-slate-700">
                        Description
                      </span>
                      <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        rows={5}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-indigo-500/20 placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2"
                        placeholder="What is this course about?"
                      />
                    </label>
                  </div>
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-900/5">
                  <h2 className="text-sm font-semibold text-slate-900">Publishing</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Published courses appear in the catalog. Drafts are only reachable by direct link.
                  </p>
                  <div className="mt-4 flex items-center gap-3">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={published}
                      onClick={() => void onPublishedToggle()}
                      disabled={saveStatus === 'saving'}
                      className={`relative inline-flex h-7 w-12 shrink-0 rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:opacity-50 ${
                        published ? 'bg-indigo-600' : 'bg-slate-200'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow ring-0 transition ${
                          published ? 'translate-x-5' : 'translate-x-0.5'
                        }`}
                      />
                    </button>
                    <span className="text-sm font-medium text-slate-800">
                      {published ? 'Published' : 'Draft'}
                    </span>
                  </div>
                </section>

                {saveMessage && (
                  <p
                    className={
                      saveStatus === 'error' ? 'text-sm text-rose-700' : 'text-sm text-emerald-700'
                    }
                    role="status"
                  >
                    {saveMessage}
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="submit"
                    disabled={saveStatus === 'saving'}
                    className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {saveStatus === 'saving' ? 'Saving…' : 'Save changes'}
                  </button>
                </div>
              </form>
            </>
          )}

          {section === 'dates' && (
            <form onSubmit={onSaveForm} className="space-y-6">
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-900/5">
                <h2 className="text-sm font-semibold text-slate-900">Schedule & visibility</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Clear a field to remove that date. Times use your local timezone.
                </p>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <DateField
                    label="Start"
                    value={startsAt}
                    onChange={setStartsAt}
                    onClear={() => setStartsAt('')}
                  />
                  <DateField
                    label="End"
                    value={endsAt}
                    onChange={setEndsAt}
                    onClear={() => setEndsAt('')}
                  />
                  <DateField
                    label="Visible from"
                    value={visibleFrom}
                    onChange={setVisibleFrom}
                    onClear={() => setVisibleFrom('')}
                  />
                  <DateField
                    label="Hidden after"
                    value={hiddenAt}
                    onChange={setHiddenAt}
                    onClear={() => setHiddenAt('')}
                  />
                </div>
              </section>

              {saveMessage && (
                <p
                  className={
                    saveStatus === 'error' ? 'text-sm text-rose-700' : 'text-sm text-emerald-700'
                  }
                  role="status"
                >
                  {saveMessage}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  disabled={saveStatus === 'saving'}
                  className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saveStatus === 'saving' ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </form>
          )}

          {section === 'branding' && (
            <>
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-900/5">
                <h2 className="text-sm font-semibold text-slate-900">Hero image</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Generate a cover image with AI (model is configured under Settings → AI).
                </p>
                {course.heroImageUrl && (
                  <img
                    src={course.heroImageUrl}
                    alt=""
                    className="mt-4 max-h-48 w-full max-w-md rounded-xl border border-slate-200 object-cover"
                    style={heroImageObjectStyle(course.heroImageObjectPosition)}
                  />
                )}
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={openImageModal}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-900"
                  >
                    <ImageIcon className="h-4 w-4" aria-hidden />
                    Generate image
                  </button>
                  <button
                    type="button"
                    onClick={openPositionModal}
                    disabled={!course.heroImageUrl}
                    title={!course.heroImageUrl ? 'Add a hero image first' : undefined}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-900 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Move className="h-4 w-4" aria-hidden />
                    Position image
                  </button>
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-900/5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">Reading theme</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Applies to the syllabus, content pages, and assignments. Choosing a preset saves immediately.
                    </p>
                  </div>
                  {(mdThemeStatus !== 'idle' || mdThemeMessage) && (
                    <p
                      className={
                        mdThemeStatus === 'error' ? 'text-sm text-rose-700' : 'text-sm text-emerald-700'
                      }
                      role="status"
                    >
                      {mdThemeStatus === 'saving' ? 'Saving…' : mdThemeMessage}
                    </p>
                  )}
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {MARKDOWN_THEME_PRESET_META.map((meta) => {
                    const selected = course.markdownThemePreset === meta.id
                    return (
                      <button
                        key={meta.id}
                        type="button"
                        onClick={() => void selectMarkdownPreset(meta.id)}
                        disabled={mdThemeStatus === 'saving'}
                        className={`relative flex flex-col rounded-xl border p-4 text-left transition ${
                          selected
                            ? 'border-indigo-500 bg-indigo-50/60 ring-2 ring-indigo-500/30'
                            : 'border-slate-200 bg-white hover:border-indigo-200 hover:bg-slate-50/80'
                        } disabled:opacity-60`}
                      >
                        {selected && (
                          <span className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-white">
                            <Check className="h-3.5 w-3.5" aria-hidden />
                          </span>
                        )}
                        <span className="text-sm font-semibold text-slate-900">{meta.title}</span>
                        <span className="mt-1 text-xs leading-snug text-slate-600">{meta.description}</span>
                        <span
                          className={`mt-3 block h-8 rounded-md ${
                            meta.id === 'night'
                              ? 'bg-slate-900'
                              : meta.id === 'reader'
                                ? 'bg-stone-100 ring-1 ring-stone-200'
                                : meta.id === 'contrast'
                                  ? 'border-2 border-black bg-white'
                                  : meta.id === 'serif'
                                    ? 'bg-amber-50/80'
                                    : meta.id === 'accent'
                                      ? 'bg-violet-100/80'
                                      : 'bg-slate-100'
                          }`}
                          aria-hidden
                        />
                      </button>
                    )
                  })}
                </div>

                <div className="mt-8 border-t border-slate-200 pt-6">
                  <h3 className="text-sm font-semibold text-slate-900">Custom theme</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Set colors and layout, then save. Active when{' '}
                    <span className="font-medium text-slate-700">Custom</span> is stored — use Save after editing,
                    or pick a preset above to reset to a built-in look.
                  </p>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <label className="block text-xs font-medium text-slate-600">
                      Heading color
                      <input
                        type="color"
                        value={customDraft.headingColor ?? markdownThemeCustomSeed.headingColor}
                        onChange={(e) =>
                          setCustomDraft((d) => ({ ...d, headingColor: e.target.value }))
                        }
                        className="mt-1 h-9 w-full cursor-pointer rounded border border-slate-200 bg-white"
                      />
                    </label>
                    <label className="block text-xs font-medium text-slate-600">
                      Body text
                      <input
                        type="color"
                        value={customDraft.bodyColor ?? markdownThemeCustomSeed.bodyColor}
                        onChange={(e) => setCustomDraft((d) => ({ ...d, bodyColor: e.target.value }))}
                        className="mt-1 h-9 w-full cursor-pointer rounded border border-slate-200 bg-white"
                      />
                    </label>
                    <label className="block text-xs font-medium text-slate-600">
                      Links
                      <input
                        type="color"
                        value={customDraft.linkColor ?? markdownThemeCustomSeed.linkColor}
                        onChange={(e) => setCustomDraft((d) => ({ ...d, linkColor: e.target.value }))}
                        className="mt-1 h-9 w-full cursor-pointer rounded border border-slate-200 bg-white"
                      />
                    </label>
                    <label className="block text-xs font-medium text-slate-600">
                      Code &amp; blocks background
                      <input
                        type="color"
                        value={customDraft.codeBackground ?? markdownThemeCustomSeed.codeBackground}
                        onChange={(e) =>
                          setCustomDraft((d) => ({ ...d, codeBackground: e.target.value }))
                        }
                        className="mt-1 h-9 w-full cursor-pointer rounded border border-slate-200 bg-white"
                      />
                    </label>
                    <label className="block text-xs font-medium text-slate-600">
                      Borders &amp; quotes
                      <input
                        type="color"
                        value={customDraft.blockquoteBorder ?? markdownThemeCustomSeed.blockquoteBorder}
                        onChange={(e) =>
                          setCustomDraft((d) => ({ ...d, blockquoteBorder: e.target.value }))
                        }
                        className="mt-1 h-9 w-full cursor-pointer rounded border border-slate-200 bg-white"
                      />
                    </label>
                    <label className="block text-xs font-medium text-slate-600">
                      Article width
                      <select
                        value={customDraft.articleWidth ?? markdownThemeCustomSeed.articleWidth}
                        onChange={(e) =>
                          setCustomDraft((d) => ({
                            ...d,
                            articleWidth: e.target.value as MarkdownThemeCustom['articleWidth'],
                          }))
                        }
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                      >
                        <option value="narrow">Narrow</option>
                        <option value="comfortable">Comfortable</option>
                        <option value="wide">Wide</option>
                        <option value="full">Full width</option>
                      </select>
                    </label>
                    <label className="block text-xs font-medium text-slate-600">
                      Font
                      <select
                        value={customDraft.fontFamily ?? markdownThemeCustomSeed.fontFamily}
                        onChange={(e) =>
                          setCustomDraft((d) => ({
                            ...d,
                            fontFamily: e.target.value as MarkdownThemeCustom['fontFamily'],
                          }))
                        }
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                      >
                        <option value="sans">Sans-serif</option>
                        <option value="serif">Serif</option>
                      </select>
                    </label>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => void saveCustomMarkdownTheme()}
                      disabled={mdThemeStatus === 'saving'}
                      className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {mdThemeStatus === 'saving' ? 'Saving…' : 'Save custom theme'}
                    </button>
                    {course.markdownThemePreset === 'custom' && (
                      <span className="text-xs text-slate-500">Custom theme is active for this course.</span>
                    )}
                  </div>
                </div>
              </section>
            </>
          )}

          {section === 'grading' && <CourseGradingSettingsSection courseCode={courseCode} />}
        </div>
      )}

      {positionModalOpen && course?.heroImageUrl && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="position-hero-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) closePositionModal()
          }}
        >
          <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h3 id="position-hero-title" className="text-sm font-semibold text-slate-900">
                Position banner crop
              </h3>
              <button
                type="button"
                onClick={() => closePositionModal()}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-4">
              <p className="text-sm text-slate-600">
                Drag across the preview or tap once to choose which part of the image stays visible on
                course cards (same height as the catalog banner).
              </p>
              <div
                className={`relative mt-4 h-36 w-full touch-none select-none overflow-hidden rounded-xl border border-slate-200 bg-slate-100 ${
                  positionDragging ? 'cursor-grabbing' : 'cursor-grab'
                }`}
                role="presentation"
                onPointerDown={(e) => {
                  if (e.button !== 0) return
                  e.preventDefault()
                  const el = e.currentTarget
                  el.setPointerCapture(e.pointerId)
                  setPositionDragging(true)
                  setFocalFromClient(e.clientX, e.clientY, el)
                }}
                onPointerMove={(e) => {
                  const el = e.currentTarget
                  if (!el.hasPointerCapture(e.pointerId)) return
                  setFocalFromClient(e.clientX, e.clientY, el)
                }}
                onPointerUp={(e) => {
                  const el = e.currentTarget
                  if (el.hasPointerCapture(e.pointerId)) {
                    el.releasePointerCapture(e.pointerId)
                  }
                  setPositionDragging(false)
                }}
                onPointerCancel={(e) => {
                  const el = e.currentTarget
                  if (el.hasPointerCapture(e.pointerId)) {
                    el.releasePointerCapture(e.pointerId)
                  }
                  setPositionDragging(false)
                }}
                onLostPointerCapture={() => setPositionDragging(false)}
              >
                <img
                  src={course.heroImageUrl}
                  alt=""
                  draggable={false}
                  className="h-full w-full object-cover"
                  style={{
                    objectPosition: formatHeroObjectPosition(positionDraft.x, positionDraft.y),
                  }}
                />
                <span
                  className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-indigo-600 shadow ring-2 ring-indigo-600/30"
                  style={{ left: `${positionDraft.x}%`, top: `${positionDraft.y}%` }}
                  aria-hidden
                />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPositionDraft({ x: 50, y: 50 })}
                  className="text-sm font-medium text-indigo-600 hover:text-indigo-500"
                >
                  Reset to center
                </button>
              </div>
              {positionMessage && (
                <p
                  className={
                    positionSaveStatus === 'error' ? 'mt-3 text-sm text-rose-700' : 'mt-3 text-sm text-emerald-700'
                  }
                  role="status"
                >
                  {positionMessage}
                </p>
              )}
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => closePositionModal()}
                  className="rounded-xl px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void onSaveHeroPosition()}
                  disabled={positionSaveStatus === 'saving'}
                  className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {positionSaveStatus === 'saving' ? 'Saving…' : 'Save position'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {imageModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="gen-image-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeImageModal()
          }}
        >
          <div className="max-h-[min(90vh,720px)] w-full max-w-3xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h3 id="gen-image-title" className="text-sm font-semibold text-slate-900">
                Generate hero image
              </h3>
              <button
                type="button"
                onClick={() => closeImageModal()}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={onGenerateInModal} className="flex max-h-[calc(min(90vh,720px)-56px)] flex-col gap-4 p-4 md:flex-row md:items-stretch">
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <label htmlFor="modal-image-prompt" className="text-xs font-medium text-slate-600">
                  Prompt
                </label>
                <textarea
                  id="modal-image-prompt"
                  value={imagePrompt}
                  onChange={(e) => setImagePrompt(e.target.value)}
                  rows={8}
                  placeholder="Describe the image you want, e.g. soft watercolor campus scene at sunset."
                  className="mt-1 min-h-[140px] flex-1 resize-y rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-indigo-500/20 focus:border-indigo-400 focus:ring-2"
                />
                {genMessage && (
                  <p
                    className={
                      genStatus === 'error' || saveHeroStatus === 'error'
                        ? 'mt-2 text-sm text-rose-700'
                        : 'mt-2 text-sm text-emerald-700'
                    }
                    role="status"
                  >
                    {genMessage}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => closeImageModal()}
                    className="rounded-xl px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
                  >
                    Close
                  </button>
                  {pendingHeroUrl && (
                    <button
                      type="button"
                      onClick={() => void onSaveHeroImage()}
                      disabled={saveHeroStatus === 'saving'}
                      className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-900 shadow-sm transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Save className="h-4 w-4" aria-hidden />
                      {saveHeroStatus === 'saving' ? 'Saving…' : 'Save image'}
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={genStatus === 'loading' || !imagePrompt.trim()}
                    className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {genStatus === 'loading' ? 'Generating…' : 'Generate'}
                  </button>
                </div>
              </div>
              <div className="flex w-full shrink-0 flex-col md:w-72 lg:w-80">
                <span className="text-xs font-medium text-slate-600">Preview</span>
                <div className="mt-1 flex min-h-[200px] flex-1 items-center justify-center overflow-hidden rounded-xl border border-dashed border-slate-200 bg-slate-50">
                  {genStatus === 'loading' && (
                    <span className="text-sm text-slate-500">Generating…</span>
                  )}
                  {genStatus !== 'loading' && previewUrl && (
                    <img
                      src={previewUrl}
                      alt=""
                      className="max-h-[min(360px,50vh)] w-full object-contain"
                    />
                  )}
                  {genStatus !== 'loading' && !previewUrl && (
                    <span className="px-4 text-center text-sm text-slate-400">
                      Generated image will appear here
                    </span>
                  )}
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </LmsPage>
  )
}

function DateField({
  label,
  value,
  onChange,
  onClear,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  onClear: () => void
}) {
  const id = `date-${label.replace(/\s+/g, '-').toLowerCase()}`
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium text-slate-700">
          {label}
        </label>
        {value ? (
          <button
            type="button"
            onClick={onClear}
            className="text-xs font-medium text-indigo-600 hover:text-indigo-500"
          >
            Clear
          </button>
        ) : null}
      </div>
      <input
        id={id}
        type="datetime-local"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-indigo-500/20 focus:border-indigo-400 focus:ring-2"
      />
    </div>
  )
}
