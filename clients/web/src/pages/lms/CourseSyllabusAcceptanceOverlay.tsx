import { useEffect, useMemo, useState } from 'react'
import {
  fetchCourse,
  fetchCourseSyllabus,
  fetchSyllabusAcceptanceStatus,
  postSyllabusAccept,
  type SyllabusSection,
} from '../../lib/coursesApi'
import { SyllabusMarkdownView } from '../../components/syllabus/SyllabusMarkdownView'
import { resolveMarkdownTheme, type MarkdownThemeCustom } from '../../lib/markdownTheme'
import { useLmsDarkMode } from '../../hooks/useLmsDarkMode'

type SyllabusAcceptGate = 'checking' | 'ok' | 'needs'

/**
 * Blocks interaction until enrolled students acknowledge the syllabus when required.
 * Instructors (course item create) skip via the API.
 */
export function CourseSyllabusAcceptanceOverlay({ courseCode }: { courseCode: string }) {
  const [syllabusGate, setSyllabusGate] = useState<SyllabusAcceptGate>('checking')
  const [syllabusSections, setSyllabusSections] = useState<SyllabusSection[] | null>(null)
  const [mdPreset, setMdPreset] = useState('classic')
  const [mdCustom, setMdCustom] = useState<MarkdownThemeCustom | null>(null)
  const [acceptError, setAcceptError] = useState<string | null>(null)
  const [accepting, setAccepting] = useState(false)

  const lmsUiDark = useLmsDarkMode()
  const mdTheme = useMemo(
    () => resolveMarkdownTheme(mdPreset, mdCustom, { lmsUiDark }),
    [mdPreset, mdCustom, lmsUiDark],
  )

  useEffect(() => {
    let cancelled = false
    setSyllabusGate('checking')
    setSyllabusSections(null)
    setAcceptError(null)
    ;(async () => {
      try {
        const st = await fetchSyllabusAcceptanceStatus(courseCode)
        if (cancelled) return
        if (!st.requireSyllabusAcceptance || st.hasAcceptedSyllabus) {
          setSyllabusGate('ok')
          return
        }
        const [syllabus, courseRow] = await Promise.all([
          fetchCourseSyllabus(courseCode),
          fetchCourse(courseCode),
        ])
        if (cancelled) return
        setMdPreset(courseRow.markdownThemePreset)
        setMdCustom(courseRow.markdownThemeCustom)
        setSyllabusSections(syllabus.sections)
        setSyllabusGate('needs')
      } catch {
        if (!cancelled) setSyllabusGate('ok')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [courseCode])

  async function handleAcceptSyllabus() {
    setAcceptError(null)
    setAccepting(true)
    try {
      await postSyllabusAccept(courseCode)
      setSyllabusGate('ok')
      setSyllabusSections(null)
    } catch (e) {
      setAcceptError(e instanceof Error ? e.message : 'Could not record your acceptance.')
    } finally {
      setAccepting(false)
    }
  }

  if (syllabusGate === 'ok') {
    return null
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="syllabus-accept-title"
    >
      {syllabusGate === 'checking' ? (
        <div className="rounded-2xl bg-white px-8 py-6 text-sm font-medium text-slate-700 shadow-xl dark:bg-neutral-900 dark:text-neutral-200">
          Checking syllabus…
        </div>
      ) : (
        <div className="flex max-h-[min(90vh,720px)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-neutral-900">
          <div className="border-b border-slate-200 px-6 py-4 dark:border-neutral-700">
            <h2 id="syllabus-accept-title" className="text-lg font-semibold text-slate-900 dark:text-neutral-100">
              Review course syllabus
            </h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-neutral-400">
              Your instructor requires you to acknowledge the syllabus before you continue in this course.
            </p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            {syllabusSections && syllabusSections.length > 0 ? (
              <SyllabusMarkdownView sections={syllabusSections} theme={mdTheme} />
            ) : (
              <p className="text-sm text-slate-600 dark:text-neutral-400">
                No syllabus text has been published yet. You can still confirm that you agree to follow course
                policies as they appear here when your instructor adds them.
              </p>
            )}
          </div>
          {acceptError && (
            <p className="border-t border-rose-200 bg-rose-50 px-6 py-2 text-sm text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-200">
              {acceptError}
            </p>
          )}
          <div className="border-t border-slate-200 px-6 py-4 dark:border-neutral-700">
            <button
              type="button"
              onClick={() => void handleAcceptSyllabus()}
              disabled={accepting}
              className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {accepting ? 'Saving…' : 'I have read and accept the syllabus'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
