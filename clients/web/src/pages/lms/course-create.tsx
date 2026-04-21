import { type FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Check, ChevronRight, FileText, LayoutList, Sparkles } from 'lucide-react'
import { RequirePermission } from '../../components/require-permission'
import { usePermissions } from '../../context/use-permissions'
import { LmsPage } from './lms-page'
import {
  createCourse,
  createCourseModule,
  patchCourseSyllabus,
  putCourse,
  type CoursePublic,
  type SyllabusSection,
} from '../../lib/courses-api'
import { PERM_COURSE_CREATE } from '../../lib/rbac-api'
import {
  COURSE_CREATE_STARTER_TEMPLATES,
  templateSectionsToSyllabus,
} from './course-create-templates'

const BLANK_TEMPLATE_ID = 'blank'

type WizardStep = 1 | 2 | 3

function putBodyFromCourse(c: CoursePublic, title: string, description: string) {
  const mode = c.scheduleMode === 'relative' ? 'relative' : 'fixed'
  return {
    title: title.trim(),
    description: description.trim(),
    published: c.published,
    startsAt: c.startsAt ?? null,
    endsAt: c.endsAt ?? null,
    visibleFrom: c.visibleFrom ?? null,
    hiddenAt: c.hiddenAt ?? null,
    scheduleMode: mode,
    relativeEndAfter: c.relativeEndAfter ?? null,
    relativeHiddenAfter: c.relativeHiddenAfter ?? null,
  } as const
}

export default function CourseCreate() {
  const navigate = useNavigate()
  const { refresh } = usePermissions()
  const [step, setStep] = useState<WizardStep>(1)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [createdCourse, setCreatedCourse] = useState<CoursePublic | null>(null)
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('higher-ed-15-week')
  const [firstModuleTitle, setFirstModuleTitle] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const stepTitle = step === 1 ? 'Basics' : step === 2 ? 'Syllabus template' : 'First module'

  async function submitBasics(e: FormEvent) {
    e.preventDefault()
    const t = title.trim()
    if (!t) {
      setError('Enter a course title.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      if (createdCourse) {
        const updated = await putCourse(
          createdCourse.courseCode,
          putBodyFromCourse(createdCourse, t, description.trim()),
        )
        setCreatedCourse(updated)
      } else {
        const course = await createCourse({ title: t, description: description.trim() })
        setCreatedCourse(course)
      }
      setStep(2)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.')
    } finally {
      setSubmitting(false)
    }
  }

  async function continueFromSyllabusStep() {
    if (!createdCourse) return
    setSubmitting(true)
    setError(null)
    try {
      if (selectedTemplateId !== BLANK_TEMPLATE_ID) {
        const tmpl = COURSE_CREATE_STARTER_TEMPLATES.find((x) => x.id === selectedTemplateId)
        if (tmpl) {
          const sections: SyllabusSection[] = templateSectionsToSyllabus(tmpl.sections)
          await patchCourseSyllabus(createdCourse.courseCode, {
            sections,
            requireSyllabusAcceptance: false,
          })
        }
      }
      setFirstModuleTitle((prev) => {
        if (prev.trim()) return prev
        if (selectedTemplateId === BLANK_TEMPLATE_ID) return 'Getting started'
        const tmpl = COURSE_CREATE_STARTER_TEMPLATES.find((x) => x.id === selectedTemplateId)
        return tmpl?.suggestedFirstModuleTitle ?? 'Getting started'
      })
      setStep(3)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not apply syllabus template.')
    } finally {
      setSubmitting(false)
    }
  }

  async function finishWizard(skipModule: boolean) {
    if (!createdCourse) return
    setSubmitting(true)
    setError(null)
    try {
      if (!skipModule) {
        const m = firstModuleTitle.trim()
        if (m) {
          await createCourseModule(createdCourse.courseCode, { title: m })
        }
      }
      await refresh()
      navigate(`/courses/${encodeURIComponent(createdCourse.courseCode)}`, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not finish setup.')
    } finally {
      setSubmitting(false)
    }
  }

  function goBack() {
    setError(null)
    if (step === 2) {
      if (createdCourse) {
        setTitle(createdCourse.title)
        setDescription(createdCourse.description)
      }
      setStep(1)
      return
    }
    if (step === 3) {
      setStep(2)
    }
  }

  const descriptionText =
    step === 1
      ? 'Step 1 of 3 — name your course. You will enroll as teacher and can publish and add learners later.'
      : step === 2
        ? 'Step 2 of 3 — pick a syllabus scaffold or start blank. You can edit everything later on the Syllabus page.'
        : 'Step 3 of 3 — optionally add your first module shell, then open the course.'

  return (
    <LmsPage
      title="Create course"
      titleContent={
        <div className="space-y-3">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-neutral-100">
            Create course
          </h1>
          <nav aria-label="Progress">
            <ol className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500 dark:text-neutral-400">
              {([1, 2, 3] as const).map((n, idx) => (
                <li key={n} className="flex items-center gap-2">
                  {idx > 0 ? (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden />
                  ) : null}
                  <span
                    className={
                      step === n
                        ? 'rounded-full bg-indigo-100 px-2.5 py-1 text-indigo-800 dark:bg-indigo-950/80 dark:text-indigo-100'
                        : step > n
                          ? 'rounded-full px-2.5 py-1 text-slate-600 dark:text-neutral-300'
                          : 'rounded-full px-2.5 py-1'
                    }
                  >
                    <span className="sr-only">{step === n ? 'Current step: ' : step > n ? 'Completed: ' : 'Not started: '}</span>
                    {n}. {n === 1 ? 'Basics' : n === 2 ? 'Syllabus' : 'Module'}
                  </span>
                </li>
              ))}
            </ol>
          </nav>
          <p className="text-xs font-medium text-indigo-700 dark:text-indigo-200/90">{stepTitle}</p>
        </div>
      }
      description={descriptionText}
      actions={
        <Link
          to="/courses"
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:border-indigo-500/40 dark:hover:bg-indigo-950/40"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to courses
        </Link>
      }
    >
      <RequirePermission
        permission={PERM_COURSE_CREATE}
        fallback={
          <p className="mt-8 max-w-xl rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:border-neutral-700 dark:bg-neutral-900/60 dark:text-neutral-200">
            You do not have permission to create courses. Ask an administrator to grant{' '}
            <code className="rounded bg-slate-200/80 px-1.5 py-0.5 font-mono text-xs dark:bg-neutral-800">
              {PERM_COURSE_CREATE}
            </code>
            .
          </p>
        }
      >
        <div className="mt-8 max-w-3xl space-y-6">
          {error && (
            <p
              className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-100"
              role="alert"
            >
              {error}
            </p>
          )}

          {step === 1 && (
            <form className="space-y-5" onSubmit={(e) => void submitBasics(e)}>
              <div>
                <label htmlFor="course-title" className="text-sm font-medium text-slate-700 dark:text-neutral-200">
                  Title
                </label>
                <input
                  id="course-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  maxLength={500}
                  placeholder="Introduction to Biology"
                  className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 shadow-sm outline-none ring-indigo-500/0 transition focus:border-indigo-300 focus:ring-2 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100 dark:focus:border-indigo-500/60"
                />
              </div>

              <div>
                <label
                  htmlFor="course-description"
                  className="text-sm font-medium text-slate-700 dark:text-neutral-200"
                >
                  Description
                </label>
                <textarea
                  id="course-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={5}
                  maxLength={20000}
                  placeholder="Optional overview for the course catalog."
                  className="mt-1.5 w-full resize-y rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 shadow-sm outline-none ring-indigo-500/0 transition focus:border-indigo-300 focus:ring-2 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100 dark:focus:border-indigo-500/60"
                />
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Continue
                  <ChevronRight className="h-4 w-4" aria-hidden />
                </button>
                <Link
                  to="/courses"
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
                >
                  Cancel
                </Link>
              </div>
            </form>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <p className="text-sm text-slate-600 dark:text-neutral-300">
                Templates add editable syllabus sections. Choose <strong className="font-semibold">Blank syllabus</strong> if
                you prefer to build from scratch.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setSelectedTemplateId(BLANK_TEMPLATE_ID)}
                  className={`flex flex-col rounded-2xl border p-4 text-left shadow-sm transition ${
                    selectedTemplateId === BLANK_TEMPLATE_ID
                      ? 'border-indigo-400 bg-indigo-50/80 ring-2 ring-indigo-300/60 dark:border-indigo-500/70 dark:bg-indigo-950/30 dark:ring-indigo-500/40'
                      : 'border-slate-200 bg-white hover:border-slate-300 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:border-neutral-600'
                  }`}
                >
                  <span className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-neutral-100">
                    <FileText className="h-5 w-5 text-slate-500 dark:text-neutral-400" aria-hidden />
                    Blank syllabus
                  </span>
                  <span className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-neutral-400">
                    No prefilled sections — add them later under Syllabus.
                  </span>
                  {selectedTemplateId === BLANK_TEMPLATE_ID ? (
                    <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-indigo-700 dark:text-indigo-200">
                      <Check className="h-3.5 w-3.5" aria-hidden />
                      Selected
                    </span>
                  ) : null}
                </button>
                {COURSE_CREATE_STARTER_TEMPLATES.map((tmpl) => {
                  const selected = selectedTemplateId === tmpl.id
                  return (
                    <button
                      key={tmpl.id}
                      type="button"
                      onClick={() => setSelectedTemplateId(tmpl.id)}
                      className={`flex flex-col rounded-2xl border p-4 text-left shadow-sm transition ${
                        selected
                          ? 'border-indigo-400 bg-indigo-50/80 ring-2 ring-indigo-300/60 dark:border-indigo-500/70 dark:bg-indigo-950/30 dark:ring-indigo-500/40'
                          : 'border-slate-200 bg-white hover:border-slate-300 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:border-neutral-600'
                      }`}
                    >
                      <span className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-neutral-100">
                        <LayoutList className="h-5 w-5 text-indigo-500 dark:text-indigo-300" aria-hidden />
                        {tmpl.name}
                      </span>
                      <span className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-neutral-400">
                        {tmpl.summary}
                      </span>
                      {selected ? (
                        <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-indigo-700 dark:text-indigo-200">
                          <Check className="h-3.5 w-3.5" aria-hidden />
                          Selected
                        </span>
                      ) : null}
                    </button>
                  )
                })}
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void continueFromSyllabusStep()}
                  className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Continue
                  <ChevronRight className="h-4 w-4" aria-hidden />
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={goBack}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
                >
                  Back
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <p className="text-sm text-slate-600 dark:text-neutral-300">
                Modules organize pages, assignments, and quizzes. You can rename, reorder, and add items anytime.
              </p>
              <div>
                <label
                  htmlFor="first-module-title"
                  className="text-sm font-medium text-slate-700 dark:text-neutral-200"
                >
                  First module title
                </label>
                <input
                  id="first-module-title"
                  value={firstModuleTitle}
                  onChange={(e) => setFirstModuleTitle(e.target.value)}
                  maxLength={500}
                  placeholder="e.g. Week 1: Introduction"
                  className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 shadow-sm outline-none ring-indigo-500/0 transition focus:border-indigo-300 focus:ring-2 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100 dark:focus:border-indigo-500/60"
                />
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void finishWizard(false)}
                  className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Sparkles className="h-4 w-4" aria-hidden />
                  {firstModuleTitle.trim() ? 'Create module & open course' : 'Open course'}
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void finishWizard(true)}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
                >
                  Skip module
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={goBack}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
                >
                  Back
                </button>
              </div>
            </div>
          )}
        </div>
      </RequirePermission>
    </LmsPage>
  )
}
