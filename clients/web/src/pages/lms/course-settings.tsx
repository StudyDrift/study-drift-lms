import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useLocation, useParams } from 'react-router-dom'
import { Check, ImageIcon, Loader2, Move, Save, X } from 'lucide-react'
import { LmsPage } from './lms-page'
import { usePermissions } from '../../context/use-permissions'
import { authorizedFetch } from '../../lib/api'
import { readApiErrorMessage } from '../../lib/errors'
import { toastMutationError, toastSaveOk } from '../../lib/lms-toast'
import {
  courseItemCreatePermission,
  fetchCourseStructure,
  patchCourseMarkdownTheme,
  type CoursePublic,
  type CourseStructureItem,
} from '../../lib/courses-api'
import {
  MARKDOWN_THEME_PRESET_META,
  markdownThemeCustomSeed,
  type MarkdownThemeCustom,
  type MarkdownThemePresetId,
} from '../../lib/markdown-theme'
import {
  formatHeroObjectPosition,
  heroImageObjectStyle,
  parseHeroObjectPosition,
} from '../../lib/hero-image-position'
import { CourseArchivedContentSection } from './course-archived-content-section'
import { CourseExportImportSection } from './course-export-import-section'
import { CourseGradingSettingsSection } from './course-grading-settings'
import { CourseFeaturesSection } from './course-features-section'
import { CourseOutcomesSection } from './course-outcomes-section'
import { CourseBlueprintSection } from './course-blueprint-settings'
import { CourseCrossListingSection } from './course-cross-listing-settings'
import { CourseSectionsSettingsSection } from './course-sections-settings'

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

type RelativeDurationUnit = 'D' | 'W' | 'M' | 'Y'

function isoDurationToParts(
  iso: string | null | undefined,
): { amount: string; unit: RelativeDurationUnit } {
  if (!iso?.trim()) return { amount: '', unit: 'M' }
  const m = /^P(\d+)([DWMY])$/i.exec(iso.trim())
  if (!m) return { amount: '', unit: 'M' }
  const u = m[2].toUpperCase()
  const unit = (['D', 'W', 'M', 'Y'].includes(u) ? u : 'M') as RelativeDurationUnit
  return { amount: m[1], unit }
}

function partsToIsoDuration(amountStr: string, unit: RelativeDurationUnit): string | null {
  const n = parseInt(amountStr, 10)
  if (!Number.isFinite(n) || n < 1) return null
  return `P${n}${unit}`
}

function defaultImagePrompt(courseTitle: string, courseDescription: string): string {
  return `Generate an image for a course banner with the following title and description:
Title: ${courseTitle}
Description: ${courseDescription}
`
}

type CourseHomeLanding = 'data' | 'calendar' | 'content_page'

function normalizeCourseHomeLanding(v: string | undefined): CourseHomeLanding {
  if (v === 'calendar' || v === 'content_page') return v
  return 'data'
}

type SavePayload = {
  title: string
  description: string
  published: boolean
  startsAt: string | null
  endsAt: string | null
  visibleFrom: string | null
  hiddenAt: string | null
  scheduleMode: 'fixed' | 'relative'
  relativeEndAfter: string | null
  relativeHiddenAfter: string | null
  courseHomeLanding: CourseHomeLanding
  courseHomeContentItemId: string | null
}

type SettingsSection =
  | 'general'
  | 'grading'
  | 'outcomes'
  | 'features'
  | 'sections'
  | 'import-export'
  | 'blueprint'
  | 'archive'

/** Canonical URLs: `/settings/general`, …; legacy slugs redirect here. */
function courseSettingsLegacyRedirect(courseCode: string, pathname: string): string | null {
  const base = `/courses/${encodeURIComponent(courseCode)}/settings`
  if (pathname === base || pathname === `${base}/`) {
    return `${base}/general`
  }
  if (!pathname.startsWith(`${base}/`)) return null
  const rest = pathname.slice(base.length + 1).replace(/\/+$/, '')
  const parts = rest.split('/').filter(Boolean)
  if (parts.length !== 1) {
    return `${base}/general`
  }
  const seg = parts[0]
  if (seg === 'dates' || seg === 'branding' || seg === 'basic') return `${base}/general`
  if (seg === 'features-tools') return `${base}/features`
  if (seg === 'export-import') return `${base}/import-export`
  if (seg === 'archived') return `${base}/archive`
  return null
}

function parseSettingsSection(courseCode: string, pathname: string): SettingsSection | 'invalid' {
  const base = `/courses/${encodeURIComponent(courseCode)}/settings`
  if (pathname === base || pathname === `${base}/`) return 'invalid'
  if (!pathname.startsWith(`${base}/`)) return 'invalid'
  const rest = pathname.slice(base.length + 1).replace(/\/+$/, '')
  const parts = rest.split('/').filter(Boolean)
  if (parts.length !== 1) return 'invalid'
  const seg = parts[0]
  if (seg === 'general') return 'general'
  if (seg === 'grading') return 'grading'
  if (seg === 'outcomes') return 'outcomes'
  if (seg === 'features') return 'features'
  if (seg === 'sections') return 'sections'
  if (seg === 'import-export') return 'import-export'
  if (seg === 'blueprint') return 'blueprint'
  if (seg === 'archive') return 'archive'
  return 'invalid'
}

export default function CourseSettings() {
  const { courseCode } = useParams<{ courseCode: string }>()
  const { allows, loading: permLoading } = usePermissions()
  const location = useLocation()
  const [course, setCourse] = useState<CoursePublic | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [published, setPublished] = useState(false)
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [visibleFrom, setVisibleFrom] = useState('')
  const [hiddenAt, setHiddenAt] = useState('')
  const [scheduleMode, setScheduleMode] = useState<'fixed' | 'relative'>('fixed')
  const [relEndAmount, setRelEndAmount] = useState('')
  const [relEndUnit, setRelEndUnit] = useState<RelativeDurationUnit>('M')
  const [relHiddenAmount, setRelHiddenAmount] = useState('')
  const [relHiddenUnit, setRelHiddenUnit] = useState<RelativeDurationUnit>('M')

  const [courseHomeLanding, setCourseHomeLanding] = useState<CourseHomeLanding>('data')
  const [courseHomeContentItemId, setCourseHomeContentItemId] = useState('')
  const [structureForHomePicker, setStructureForHomePicker] = useState<CourseStructureItem[]>([])

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

  const [customDraft, setCustomDraft] = useState<MarkdownThemeCustom>(markdownThemeCustomSeed)
  const [markdownThemePreset, setMarkdownThemePreset] = useState<string>('default')

  const applyScheduleStateFromCourse = useCallback((c: CoursePublic) => {
    setStartsAt(isoToDatetimeLocal(c.startsAt))
    setEndsAt(isoToDatetimeLocal(c.endsAt))
    setVisibleFrom(isoToDatetimeLocal(c.visibleFrom))
    setHiddenAt(isoToDatetimeLocal(c.hiddenAt))
    setScheduleMode(c.scheduleMode === 'relative' ? 'relative' : 'fixed')
    const endP = isoDurationToParts(c.relativeEndAfter ?? null)
    setRelEndAmount(endP.amount)
    setRelEndUnit(endP.unit)
    const hidP = isoDurationToParts(c.relativeHiddenAfter ?? null)
    setRelHiddenAmount(hidP.amount)
    setRelHiddenUnit(hidP.unit)
  }, [])

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
      const c = raw as CoursePublic
      setCourse(c)
      setTitle(c.title)
      setDescription(c.description)
      setPublished(c.published)
      applyScheduleStateFromCourse(c)
      setCourseHomeLanding(normalizeCourseHomeLanding(c.courseHomeLanding))
      setCourseHomeContentItemId((c.courseHomeContentItemId ?? '').trim())
      setMarkdownThemePreset(c.markdownThemePreset ?? 'default')
      try {
        const items = await fetchCourseStructure(courseCode)
        setStructureForHomePicker(items)
      } catch {
        setStructureForHomePicker([])
      }
    } catch {
      setLoadError('Could not load this course.')
    } finally {
      setLoading(false)
    }
  }, [courseCode, applyScheduleStateFromCourse])

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

  const discardChanges = useCallback(() => {
    if (!course) return
    setTitle(course.title)
    setDescription(course.description)
    setPublished(course.published)
    applyScheduleStateFromCourse(course)
    setCourseHomeLanding(normalizeCourseHomeLanding(course.courseHomeLanding))
    setCourseHomeContentItemId((course.courseHomeContentItemId ?? '').trim())
    setMarkdownThemePreset(course.markdownThemePreset ?? 'default')
    setCustomDraft({
      ...markdownThemeCustomSeed,
      ...(course.markdownThemeCustom ?? {}),
    })
    setSaveStatus('idle')
    setSaveMessage(null)
  }, [course, applyScheduleStateFromCourse])

  function selectMarkdownPreset(preset: MarkdownThemePresetId) {
    setMarkdownThemePreset(preset)
  }

  const updateCustomDraft = (updater: (prev: MarkdownThemeCustom) => MarkdownThemeCustom) => {
    setCustomDraft(updater)
    setMarkdownThemePreset('custom')
  }

  const normalizeIso = (iso: string | null) => datetimeLocalToIso(isoToDatetimeLocal(iso))

  const isDirty = useMemo(() => {
    if (!course) return false

    // Check basic info
    if (title.trim() !== course.title) return true
    if (description.trim() !== course.description) return true
    if (published !== course.published) return true

    // Check course home landing
    const normHome = normalizeCourseHomeLanding(course.courseHomeLanding)
    if (courseHomeLanding !== normHome) return true
    const origHomeContentId = (course.courseHomeContentItemId ?? '').trim()
    if (courseHomeLanding === 'content_page' && courseHomeContentItemId.trim() !== origHomeContentId) return true

    // Check schedule
    if ((course.scheduleMode || 'fixed') !== scheduleMode) return true
    if (scheduleMode === 'fixed') {
      if (datetimeLocalToIso(startsAt) !== normalizeIso(course.startsAt)) return true
      if (datetimeLocalToIso(endsAt) !== normalizeIso(course.endsAt)) return true
      if (datetimeLocalToIso(visibleFrom) !== normalizeIso(course.visibleFrom)) return true
      if (datetimeLocalToIso(hiddenAt) !== normalizeIso(course.hiddenAt)) return true
    } else {
      const currentEndAfter = partsToIsoDuration(relEndAmount, relEndUnit)
      const origEndAfter = course.relativeEndAfter ?? null
      if (currentEndAfter !== origEndAfter) return true

      const currentHiddenAfter = partsToIsoDuration(relHiddenAmount, relHiddenUnit)
      const origHiddenAfter = course.relativeHiddenAfter ?? null
      if (currentHiddenAfter !== origHiddenAfter) return true
    }

    // Check theme
    if ((course.markdownThemePreset ?? 'default') !== markdownThemePreset) return true
    if (markdownThemePreset === 'custom') {
      const origCustom = course.markdownThemeCustom ?? markdownThemeCustomSeed
      if ((customDraft.headingColor ?? markdownThemeCustomSeed.headingColor) !== (origCustom.headingColor ?? markdownThemeCustomSeed.headingColor)) return true
      if ((customDraft.bodyColor ?? markdownThemeCustomSeed.bodyColor) !== (origCustom.bodyColor ?? markdownThemeCustomSeed.bodyColor)) return true
      if ((customDraft.linkColor ?? markdownThemeCustomSeed.linkColor) !== (origCustom.linkColor ?? markdownThemeCustomSeed.linkColor)) return true
      if ((customDraft.codeBackground ?? markdownThemeCustomSeed.codeBackground) !== (origCustom.codeBackground ?? markdownThemeCustomSeed.codeBackground)) return true
      if ((customDraft.blockquoteBorder ?? markdownThemeCustomSeed.blockquoteBorder) !== (origCustom.blockquoteBorder ?? markdownThemeCustomSeed.blockquoteBorder)) return true
      if ((customDraft.articleWidth ?? markdownThemeCustomSeed.articleWidth) !== (origCustom.articleWidth ?? markdownThemeCustomSeed.articleWidth)) return true
      if ((customDraft.fontFamily ?? markdownThemeCustomSeed.fontFamily) !== (origCustom.fontFamily ?? markdownThemeCustomSeed.fontFamily)) return true
    }

    return false
  }, [
    course,
    title,
    description,
    published,
    courseHomeLanding,
    courseHomeContentItemId,
    scheduleMode,
    startsAt,
    endsAt,
    visibleFrom,
    hiddenAt,
    relEndAmount,
    relEndUnit,
    relHiddenAmount,
    relHiddenUnit,
    markdownThemePreset,
    customDraft,
  ])

  function buildPayload(overrides?: Partial<{ published: boolean }>): SavePayload {
    const mode = scheduleMode
    return {
      title: title.trim(),
      description: description.trim(),
      published: overrides?.published ?? published,
      startsAt: mode === 'relative' ? null : datetimeLocalToIso(startsAt),
      endsAt: mode === 'relative' ? null : datetimeLocalToIso(endsAt),
      visibleFrom: mode === 'relative' ? null : datetimeLocalToIso(visibleFrom),
      hiddenAt: mode === 'relative' ? null : datetimeLocalToIso(hiddenAt),
      scheduleMode: mode,
      relativeEndAfter:
        mode === 'relative' ? partsToIsoDuration(relEndAmount, relEndUnit) : null,
      relativeHiddenAfter:
        mode === 'relative' ? partsToIsoDuration(relHiddenAmount, relHiddenUnit) : null,
      courseHomeLanding,
      courseHomeContentItemId:
        courseHomeLanding === 'content_page' && courseHomeContentItemId.trim()
          ? courseHomeContentItemId.trim()
          : null,
    }
  }

  async function onSingleSaveChanges() {
    if (!courseCode || !course) return
    
    const payload = buildPayload()
    if (!payload.title) {
      setSaveStatus('error')
      setSaveMessage('Title is required.')
      toastMutationError('Title is required.')
      return
    }
    if (payload.courseHomeLanding === 'content_page' && !payload.courseHomeContentItemId) {
      setSaveStatus('error')
      setSaveMessage('Choose a content page for the course home, or switch to another layout.')
      toastMutationError('Choose a content page for the course home.')
      return
    }

    setSaveStatus('saving')
    setSaveMessage(null)

    const courseSettingsDirty = (
      title.trim() !== course.title ||
      description.trim() !== course.description ||
      published !== course.published ||
      courseHomeLanding !== normalizeCourseHomeLanding(course.courseHomeLanding) ||
      (courseHomeLanding === 'content_page' && courseHomeContentItemId.trim() !== (course.courseHomeContentItemId ?? '').trim()) ||
      (course.scheduleMode || 'fixed') !== scheduleMode ||
      (scheduleMode === 'fixed' && (
        datetimeLocalToIso(startsAt) !== normalizeIso(course.startsAt) ||
        datetimeLocalToIso(endsAt) !== normalizeIso(course.endsAt) ||
        datetimeLocalToIso(visibleFrom) !== normalizeIso(course.visibleFrom) ||
        datetimeLocalToIso(hiddenAt) !== normalizeIso(course.hiddenAt)
      )) ||
      (scheduleMode === 'relative' && (
        partsToIsoDuration(relEndAmount, relEndUnit) !== (course.relativeEndAfter ?? null) ||
        partsToIsoDuration(relHiddenAmount, relHiddenUnit) !== (course.relativeHiddenAfter ?? null)
      ))
    )

    const origPreset = course.markdownThemePreset ?? 'default'
    const themePresetDirty = origPreset !== markdownThemePreset
    
    let themeCustomDirty = false
    if (markdownThemePreset === 'custom') {
      const origCustom = course.markdownThemeCustom ?? markdownThemeCustomSeed
      themeCustomDirty = (
        (customDraft.headingColor ?? markdownThemeCustomSeed.headingColor) !== (origCustom.headingColor ?? markdownThemeCustomSeed.headingColor) ||
        (customDraft.bodyColor ?? markdownThemeCustomSeed.bodyColor) !== (origCustom.bodyColor ?? markdownThemeCustomSeed.bodyColor) ||
        (customDraft.linkColor ?? markdownThemeCustomSeed.linkColor) !== (origCustom.linkColor ?? markdownThemeCustomSeed.linkColor) ||
        (customDraft.codeBackground ?? markdownThemeCustomSeed.codeBackground) !== (origCustom.codeBackground ?? markdownThemeCustomSeed.codeBackground) ||
        (customDraft.blockquoteBorder ?? markdownThemeCustomSeed.blockquoteBorder) !== (origCustom.blockquoteBorder ?? markdownThemeCustomSeed.blockquoteBorder) ||
        (customDraft.articleWidth ?? markdownThemeCustomSeed.articleWidth) !== (origCustom.articleWidth ?? markdownThemeCustomSeed.articleWidth) ||
        (customDraft.fontFamily ?? markdownThemeCustomSeed.fontFamily) !== (origCustom.fontFamily ?? markdownThemeCustomSeed.fontFamily)
      )
    }

    const themeDirty = themePresetDirty || themeCustomDirty

    try {
      let updatedCourse = course

      if (courseSettingsDirty) {
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
            scheduleMode: payload.scheduleMode,
            relativeEndAfter: payload.relativeEndAfter,
            relativeHiddenAfter: payload.relativeHiddenAfter,
            courseHomeLanding: payload.courseHomeLanding,
            courseHomeContentItemId: payload.courseHomeContentItemId,
          }),
        })
        const raw: unknown = await res.json().catch(() => ({}))
        if (!res.ok) {
          const msg = readApiErrorMessage(raw)
          setSaveStatus('error')
          setSaveMessage(msg)
          toastMutationError(msg)
          return
        }
        updatedCourse = raw as CoursePublic
      }

      if (themeDirty) {
        const themeBody = {
          preset: markdownThemePreset,
          custom: markdownThemePreset === 'custom' ? customDraft : null,
        }
        const updated = await patchCourseMarkdownTheme(courseCode, themeBody)
        updatedCourse = {
          ...updatedCourse,
          markdownThemePreset: updated.markdownThemePreset,
          markdownThemeCustom: updated.markdownThemeCustom,
        }
      }

      setCourse(updatedCourse)
      setPublished(updatedCourse.published)
      applyScheduleStateFromCourse(updatedCourse)
      setCourseHomeLanding(normalizeCourseHomeLanding(updatedCourse.courseHomeLanding))
      setCourseHomeContentItemId((updatedCourse.courseHomeContentItemId ?? '').trim())
      setMarkdownThemePreset(updatedCourse.markdownThemePreset ?? 'default')
      setCustomDraft({
        ...markdownThemeCustomSeed,
        ...(updatedCourse.markdownThemeCustom ?? {}),
      })

      setSaveStatus('saved')
      setSaveMessage('Saved successfully.')
      toastSaveOk('Course settings saved')
    } catch {
      setSaveStatus('error')
      setSaveMessage('Could not save settings.')
      toastMutationError('Could not save course settings.')
    }
  }

  function onPublishedToggle() {
    setPublished((p) => !p)
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
      const updated = raw as CoursePublic
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
      const updated = raw as CoursePublic
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

  if (permLoading) {
    return null
  }

  if (!allows(courseItemCreatePermission(courseCode))) {
    return <Navigate to={`/courses/${encodeURIComponent(courseCode)}`} replace />
  }

  const settingsBase = `/courses/${encodeURIComponent(courseCode)}/settings`
  const legacyTo = courseSettingsLegacyRedirect(courseCode, location.pathname)
  if (legacyTo) {
    return <Navigate to={legacyTo} replace />
  }

  const section = parseSettingsSection(courseCode, location.pathname)
  if (section === 'invalid') {
    return <Navigate to={`${settingsBase}/general`} replace />
  }

  const pageTitle =
    section === 'general'
      ? course?.title
        ? `${course.title} — general`
        : 'General'
      : section === 'grading'
        ? course?.title
          ? `${course.title} — grading`
          : 'Grading'
        : section === 'outcomes'
          ? course?.title
            ? `${course.title} — outcomes`
            : 'Outcomes'
          : section === 'features'
            ? course?.title
              ? `${course.title} — features`
              : 'Features'
            : section === 'sections'
              ? course?.title
                ? `${course.title} — sections`
                : 'Sections'
              : section === 'import-export'
                ? course?.title
                  ? `${course.title} — import / export`
                  : 'Import / export'
                : section === 'blueprint'
                  ? course?.title
                    ? `${course.title} — blueprint`
                    : 'Blueprint'
                  : section === 'archive'
                    ? course?.title
                      ? `${course.title} — archive`
                      : 'Archive'
                    : course?.title
                      ? `${course.title} — settings`
                      : 'Course settings'

  const pageDescription =
    section === 'general'
      ? 'Basics, course home, schedule, visibility, hero image, and reading theme for this course.'
      : section === 'grading'
        ? 'Grading scale, weighted assignment groups, and how items map to each group.'
        : section === 'outcomes'
          ? 'Define learning outcomes, map assignments and quizzes (including individual questions) with measurement and intensity levels, and review class progress from grades and attempts.'
          : section === 'features'
            ? 'Choose which course tools appear in the menu and are available to instructors and learners.'
            : section === 'sections'
              ? 'Create teaching sections, manage rosters, and set per-section assignment due dates.'
              : section === 'import-export'
                ? 'Download the full course as JSON or restore from a backup file.'
                : section === 'blueprint'
                  ? 'District curriculum blueprint: link child courses, push structural updates, and review sync history.'
                  : section === 'archive'
                    ? 'Module items you archived from the outline. Restore them when you want them visible again.'
                    : ''

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
          className="mt-8 max-w-4xl space-y-6"
        >
          {section === 'general' && (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void onSingleSaveChanges()
              }}
              className="space-y-6 pb-24"
            >
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-900/5 dark:border-neutral-800 dark:bg-neutral-900">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-neutral-50">Basic information</h2>
                <div className="mt-4 space-y-4">
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-neutral-300">Title</span>
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      required
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-indigo-500/20 focus:border-indigo-400 focus:ring-2 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-50"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-neutral-300">
                      Description
                    </span>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      rows={5}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-indigo-500/20 placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-50"
                      placeholder="What is this course about?"
                    />
                  </label>
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-900/5 dark:border-neutral-800 dark:bg-neutral-900">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-neutral-50">Publishing</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
                  Published courses appear in the catalog. Drafts are only reachable by direct link.
                </p>
                <div className="mt-4 flex items-center gap-3">
                  <button
                    type="button"
                    role="switch"
                    name="publishCourse"
                    aria-checked={published}
                    aria-label={
                      published
                        ? 'Published to catalog'
                        : 'Draft — not published to catalog'
                    }
                    onClick={() => onPublishedToggle()}
                    disabled={saveStatus === 'saving'}
                    className={`relative inline-flex h-7 w-12 shrink-0 rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:opacity-50 ${published ? 'bg-indigo-600' : 'bg-slate-200 dark:bg-neutral-800'
                      }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow ring-0 transition ${published ? 'translate-x-5' : 'translate-x-0.5'
                        }`}
                    />
                  </button>
                  <span className="text-sm font-medium text-slate-800 dark:text-neutral-300">
                    {published ? 'Published' : 'Draft'}
                  </span>
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-900/5 dark:border-neutral-800 dark:bg-neutral-900">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-neutral-50">Course home</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
                  What learners and staff see first when they open this course (the course dashboard).
                </p>
                <fieldset className="mt-4 space-y-3">
                  <legend className="sr-only">Course home layout</legend>
                  <label className="flex cursor-pointer gap-3 rounded-xl border border-slate-100 p-3 hover:border-indigo-200 dark:border-neutral-800/50 dark:hover:border-indigo-800">
                    <input
                      type="radio"
                      name="courseHomeLanding"
                      checked={courseHomeLanding === 'data'}
                      onChange={() => {
                        setCourseHomeLanding('data')
                        setCourseHomeContentItemId('')
                      }}
                      className="mt-1"
                    />
                    <span>
                      <span className="block text-sm font-medium text-slate-900 dark:text-neutral-50">
                        Data dashboard
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-500 dark:text-neutral-400">
                        Deadlines, announcements, grades, and course details at a glance.
                      </span>
                    </span>
                  </label>
                  <label className="flex cursor-pointer gap-3 rounded-xl border border-slate-100 p-3 hover:border-indigo-200 dark:border-neutral-800/50 dark:hover:border-indigo-800">
                    <input
                      type="radio"
                      name="courseHomeLanding"
                      checked={courseHomeLanding === 'calendar'}
                      onChange={() => {
                        setCourseHomeLanding('calendar')
                        setCourseHomeContentItemId('')
                      }}
                      className="mt-1"
                    />
                    <span>
                      <span className="block text-sm font-medium text-slate-900 dark:text-neutral-50">
                        Course calendar
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-500 dark:text-neutral-400">
                        Due dates and the month / week views as the landing experience.
                      </span>
                    </span>
                  </label>
                  <label className="flex cursor-pointer gap-3 rounded-xl border border-slate-100 p-3 hover:border-indigo-200 dark:border-neutral-800/50 dark:hover:border-indigo-800">
                    <input
                      type="radio"
                      name="courseHomeLanding"
                      checked={courseHomeLanding === 'content_page'}
                      onChange={() => setCourseHomeLanding('content_page')}
                      className="mt-1"
                    />
                    <span>
                      <span className="block text-sm font-medium text-slate-900 dark:text-neutral-50">
                        A specific content page
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-500 dark:text-neutral-400">
                        Open the course directly on a page from the module outline (for example, a welcome page).
                      </span>
                    </span>
                  </label>
                </fieldset>
                {courseHomeLanding === 'content_page' ? (
                  <label className="mt-4 block">
                    <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-neutral-300">
                      Content page
                    </span>
                    <select
                      value={courseHomeContentItemId}
                      onChange={(e) => setCourseHomeContentItemId(e.target.value)}
                      className="w-full max-w-lg rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-indigo-500/20 focus:border-indigo-400 focus:ring-2 dark:border-neutral-600 dark:bg-neutral-950 dark:text-neutral-50"
                    >
                      <option value="">Select a page…</option>
                      {structureForHomePicker
                        .filter((i) => i.kind === 'content_page')
                        .map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.title}
                          </option>
                        ))}
                    </select>
                    {structureForHomePicker.filter((i) => i.kind === 'content_page').length === 0 ? (
                      <p className="mt-2 text-xs text-amber-800 dark:text-amber-200">
                        Add a content page in Modules first, then pick it here.
                      </p>
                    ) : null}
                  </label>
                ) : null}
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-900/5 dark:border-neutral-800 dark:bg-neutral-900">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-neutral-50">Fixed Schedule & Visibility</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
                  Control whether the course uses fixed calendar dates or a timeline from each
                  student’s enrollment. Module release and due dates follow the same mode: relative
                  courses shift those dates by the same offset.
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={scheduleMode === 'relative'}
                    aria-label={
                      scheduleMode === 'relative'
                        ? 'Relative schedule from each enrollment'
                        : 'Fixed calendar schedule (not relative to enrollment)'
                    }
                    onClick={() =>
                      setScheduleMode((m) => (m === 'fixed' ? 'relative' : 'fixed'))
                    }
                    disabled={saveStatus === 'saving'}
                    className={`relative inline-flex h-7 w-12 shrink-0 rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:opacity-50 ${scheduleMode === 'relative' ? 'bg-indigo-600' : 'bg-slate-200 dark:bg-neutral-800'
                      }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow ring-0 transition ${scheduleMode === 'relative' ? 'translate-x-5' : 'translate-x-0.5'
                        }`}
                    />
                  </button>
                  <span className="text-sm font-medium text-slate-800 dark:text-neutral-300">
                    {scheduleMode === 'fixed'
                      ? 'Fixed (calendar dates)'
                      : 'Relative (from enrollment)'}
                  </span>
                </div>
                {scheduleMode === 'fixed' ? (
                  <>
                    <p className="mt-3 text-sm text-slate-500 dark:text-neutral-400">
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
                  </>
                ) : (
                  <>
                    <p className="mt-3 text-sm text-slate-500 dark:text-neutral-400">
                      Start and catalog visibility begin when the student is enrolled. Set how long
                      the course runs and when it drops from the catalog (optional). Durations use
                      ISO-style lengths (days, weeks, months, or years).
                    </p>
                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                      <RelativeDurationField
                        label="End after"
                        amount={relEndAmount}
                        unit={relEndUnit}
                        onAmountChange={setRelEndAmount}
                        onUnitChange={setRelEndUnit}
                        onClear={() => setRelEndAmount('')}
                      />
                      <RelativeDurationField
                        label="Hidden from catalog after"
                        amount={relHiddenAmount}
                        unit={relHiddenUnit}
                        onAmountChange={setRelHiddenAmount}
                        onUnitChange={setRelHiddenUnit}
                        onClear={() => setRelHiddenAmount('')}
                      />
                    </div>
                  </>
                )}
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-900/5 dark:border-neutral-800 dark:bg-neutral-900">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-neutral-50">Hero image</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
                  Generate a cover image with AI (model is configured under Settings → AI).
                </p>
                {course.heroImageUrl && (
                  <img
                    src={course.heroImageUrl}
                    alt=""
                    className="mt-4 max-h-48 w-full max-w-md rounded-xl border border-slate-200 object-cover dark:border-neutral-805"
                    style={heroImageObjectStyle(course.heroImageObjectPosition)}
                  />
                )}
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={openImageModal}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-900 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-350 dark:hover:border-indigo-900 dark:hover:bg-indigo-950 dark:hover:text-indigo-100"
                  >
                    <ImageIcon className="h-4 w-4" aria-hidden />
                    Generate image
                  </button>
                  <button
                    type="button"
                    onClick={openPositionModal}
                    disabled={!course.heroImageUrl}
                    title={!course.heroImageUrl ? 'Add a hero image first' : undefined}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-350 dark:hover:border-indigo-900 dark:hover:bg-indigo-950 dark:hover:text-indigo-100"
                  >
                    <Move className="h-4 w-4" aria-hidden />
                    Position image
                  </button>
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-900/5 dark:border-neutral-800 dark:bg-neutral-900">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900 dark:text-neutral-50">Reading theme</h2>
                    <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
                      Applies to the syllabus, content pages, and assignments. Choosing a preset is staged and saved via the main save bar.
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {MARKDOWN_THEME_PRESET_META.map((meta) => {
                    const selected = markdownThemePreset === meta.id
                    return (
                      <button
                        key={meta.id}
                        type="button"
                        onClick={() => selectMarkdownPreset(meta.id)}
                        disabled={saveStatus === 'saving'}
                        className={`relative flex flex-col rounded-xl border p-4 text-left transition ${selected
                          ? 'border-indigo-500 bg-indigo-50/60 ring-2 ring-indigo-500/30 dark:border-indigo-500 dark:bg-indigo-950/30'
                          : 'border-slate-200 bg-white hover:border-indigo-200 hover:bg-slate-50/80 dark:border-neutral-800 dark:bg-neutral-950 dark:hover:border-indigo-850 dark:hover:bg-neutral-900/50'
                          } disabled:opacity-60`}
                      >
                        {selected && (
                          <span className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-white">
                            <Check className="h-3.5 w-3.5" aria-hidden />
                          </span>
                        )}
                        <span className="text-sm font-semibold text-slate-900 dark:text-neutral-50">{meta.title}</span>
                        <span className="mt-1 text-xs leading-snug text-slate-600 dark:text-neutral-400">{meta.description}</span>
                        <span
                          className={`mt-3 block h-8 rounded-md ${meta.id === 'night'
                            ? 'bg-slate-900'
                            : meta.id === 'reader'
                              ? 'bg-stone-100 ring-1 ring-stone-200 dark:ring-stone-850'
                              : meta.id === 'contrast'
                                ? 'border-2 border-black bg-white dark:border-neutral-50 dark:bg-neutral-950'
                                : meta.id === 'serif'
                                  ? 'bg-amber-50/80 dark:bg-amber-950/25'
                                  : meta.id === 'accent'
                                    ? 'bg-violet-100/80 dark:bg-violet-950/25'
                                    : 'bg-slate-100 dark:bg-neutral-800'
                            }`}
                          aria-hidden
                        />
                      </button>
                    )
                  })}
                </div>

                <div className="mt-8 border-t border-slate-200 pt-6 dark:border-neutral-800">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-neutral-50">Custom theme</h3>
                  <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
                    Set colors and layout. Active when{' '}
                    <span className="font-medium text-slate-700 dark:text-neutral-300">Custom</span> preset is active — edit values below, then save with the main save bar.
                  </p>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <label className="block text-xs font-medium text-slate-600 dark:text-neutral-400">
                      Heading color
                      <input
                        type="color"
                        value={customDraft.headingColor ?? markdownThemeCustomSeed.headingColor}
                        onChange={(e) =>
                          updateCustomDraft((d) => ({ ...d, headingColor: e.target.value }))
                        }
                        className="mt-1 h-9 w-full cursor-pointer rounded border border-slate-200 bg-white dark:border-neutral-800 dark:bg-neutral-950"
                      />
                    </label>
                    <label className="block text-xs font-medium text-slate-600 dark:text-neutral-400">
                      Body text
                      <input
                        type="color"
                        value={customDraft.bodyColor ?? markdownThemeCustomSeed.bodyColor}
                        onChange={(e) =>
                          updateCustomDraft((d) => ({ ...d, bodyColor: e.target.value }))
                        }
                        className="mt-1 h-9 w-full cursor-pointer rounded border border-slate-200 bg-white dark:border-neutral-800 dark:bg-neutral-950"
                      />
                    </label>
                    <label className="block text-xs font-medium text-slate-600 dark:text-neutral-400">
                      Links
                      <input
                        type="color"
                        value={customDraft.linkColor ?? markdownThemeCustomSeed.linkColor}
                        onChange={(e) =>
                          updateCustomDraft((d) => ({ ...d, linkColor: e.target.value }))
                        }
                        className="mt-1 h-9 w-full cursor-pointer rounded border border-slate-200 bg-white dark:border-neutral-800 dark:bg-neutral-950"
                      />
                    </label>
                    <label className="block text-xs font-medium text-slate-600 dark:text-neutral-400">
                      Code &amp; blocks background
                      <input
                        type="color"
                        value={customDraft.codeBackground ?? markdownThemeCustomSeed.codeBackground}
                        onChange={(e) =>
                          updateCustomDraft((d) => ({ ...d, codeBackground: e.target.value }))
                        }
                        className="mt-1 h-9 w-full cursor-pointer rounded border border-slate-200 bg-white dark:border-neutral-800 dark:bg-neutral-950"
                      />
                    </label>
                    <label className="block text-xs font-medium text-slate-600 dark:text-neutral-400">
                      Borders &amp; quotes
                      <input
                        type="color"
                        value={customDraft.blockquoteBorder ?? markdownThemeCustomSeed.blockquoteBorder}
                        onChange={(e) =>
                          updateCustomDraft((d) => ({ ...d, blockquoteBorder: e.target.value }))
                        }
                        className="mt-1 h-9 w-full cursor-pointer rounded border border-slate-200 bg-white dark:border-neutral-800 dark:bg-neutral-950"
                      />
                    </label>
                    <label className="block text-xs font-medium text-slate-600 dark:text-neutral-400">
                      Article width
                      <select
                        value={customDraft.articleWidth ?? markdownThemeCustomSeed.articleWidth}
                        onChange={(e) =>
                          updateCustomDraft((d) => ({
                            ...d,
                            articleWidth: e.target.value as MarkdownThemeCustom['articleWidth'],
                          }))
                        }
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-50"
                      >
                        <option value="narrow">Narrow</option>
                        <option value="comfortable">Comfortable</option>
                        <option value="wide">Wide</option>
                        <option value="full">Full width</option>
                      </select>
                    </label>
                    <label className="block text-xs font-medium text-slate-600 dark:text-neutral-400">
                      Font
                      <select
                        value={customDraft.fontFamily ?? markdownThemeCustomSeed.fontFamily}
                        onChange={(e) =>
                          updateCustomDraft((d) => ({
                            ...d,
                            fontFamily: e.target.value as MarkdownThemeCustom['fontFamily'],
                          }))
                        }
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-50"
                      >
                        <option value="sans">Sans-serif</option>
                        <option value="serif">Serif</option>
                      </select>
                    </label>
                  </div>
                  <div className="mt-4">
                    {markdownThemePreset === 'custom' && (
                      <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400">Custom theme will be saved when you apply changes.</span>
                    )}
                  </div>
                </div>
              </section>
            </form>
          )}

          {section === 'grading' && <CourseGradingSettingsSection courseCode={courseCode} />}
          {section === 'outcomes' && <CourseOutcomesSection courseCode={courseCode} />}
          {section === 'features' && (
            <CourseFeaturesSection
              courseCode={courseCode}
              course={course}
              onCourseUpdated={setCourse}
            />
          )}
          {section === 'sections' &&
            (course.sectionsEnabled ? (
              <>
                <CourseSectionsSettingsSection courseCode={courseCode} />
                <CourseCrossListingSection
                  courseCode={courseCode}
                  courseId={course.id}
                  orgId={course.orgId}
                />
              </>
            ) : (
              <p className="text-sm text-slate-600 dark:text-neutral-300">
                Turn on <span className="font-medium">Course sections</span> under the Features tab
                first, then return here to add sections and overrides.
              </p>
            ))}
          {section === 'import-export' && <CourseExportImportSection courseCode={courseCode} />}
          {section === 'blueprint' && course && (
            <CourseBlueprintSection courseCode={courseCode} course={course} onCourseUpdated={setCourse} />
          )}
          {section === 'archive' && <CourseArchivedContentSection courseCode={courseCode} />}
        </div>
      )}

      {section === 'general' && isDirty && (
        <div className="fixed bottom-6 left-1/2 z-50 w-full max-w-2xl -translate-x-1/2 px-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white/90 px-6 py-4 shadow-xl backdrop-blur-md dark:border-neutral-850 dark:bg-neutral-900/90">
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-slate-900 dark:text-neutral-50">Unsaved changes</span>
              <span className="text-xs text-slate-500 dark:text-neutral-400">
                {saveStatus === 'error' && saveMessage ? (
                  <span className="text-rose-600 dark:text-rose-400 font-medium">{saveMessage}</span>
                ) : (
                  "You have modified this course's settings."
                )}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={discardChanges}
                disabled={saveStatus === 'saving'}
                className="rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50 dark:text-neutral-400 dark:hover:bg-neutral-850 dark:hover:text-neutral-200 transition"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={() => void onSingleSaveChanges()}
                disabled={saveStatus === 'saving'}
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-60 transition active:scale-95"
              >
                {saveStatus === 'saving' ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4" />
                    Save changes
                  </>
                )}
              </button>
            </div>
          </div>
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
                className={`relative mt-4 h-36 w-full touch-none select-none overflow-hidden rounded-xl border border-slate-200 bg-slate-100 ${positionDragging ? 'cursor-grabbing' : 'cursor-grab'
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

function RelativeDurationField({
  label,
  amount,
  unit,
  onAmountChange,
  onUnitChange,
  onClear,
}: {
  label: string
  amount: string
  unit: RelativeDurationUnit
  onAmountChange: (v: string) => void
  onUnitChange: (u: RelativeDurationUnit) => void
  onClear: () => void
}) {
  const id = `rel-${label.replace(/\s+/g, '-').toLowerCase()}`
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium text-slate-700">
          {label}
        </label>
        {amount ? (
          <button
            type="button"
            onClick={onClear}
            className="text-xs font-medium text-indigo-600 hover:text-indigo-500"
          >
            Clear
          </button>
        ) : null}
      </div>
      <div className="flex gap-2">
        <input
          id={id}
          type="number"
          min={1}
          step={1}
          inputMode="numeric"
          placeholder="e.g. 3"
          value={amount}
          onChange={(e) => onAmountChange(e.target.value)}
          className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-indigo-500/20 placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2"
        />
        <select
          aria-label={`${label} unit`}
          value={unit}
          onChange={(e) => onUnitChange(e.target.value as RelativeDurationUnit)}
          className="w-36 shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-indigo-500/20 focus:border-indigo-400 focus:ring-2"
        >
          <option value="D">Days</option>
          <option value="W">Weeks</option>
          <option value="M">Months</option>
          <option value="Y">Years</option>
        </select>
      </div>
    </div>
  )
}
