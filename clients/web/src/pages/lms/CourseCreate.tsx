import { type FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { RequirePermission } from '../../components/RequirePermission'
import { LmsPage } from './LmsPage'
import { createCourse } from '../../lib/coursesApi'
import { PERM_COURSE_CREATE } from '../../lib/rbacApi'

export default function CourseCreate() {
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const t = title.trim()
    if (!t) {
      setError('Enter a course title.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const course = await createCourse({ title: t, description: description.trim() })
      navigate(`/courses/${encodeURIComponent(course.courseCode)}`, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create course.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <LmsPage
      title="Create course"
      description="Add a new course. You will be enrolled as teacher and can publish and enroll learners later."
      actions={
        <Link
          to="/courses"
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-900"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to courses
        </Link>
      }
    >
      <RequirePermission
        permission={PERM_COURSE_CREATE}
        fallback={
          <p className="mt-8 max-w-xl rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            You do not have permission to create courses. Ask an administrator to grant{' '}
            <code className="rounded bg-slate-200/80 px-1.5 py-0.5 font-mono text-xs">
              {PERM_COURSE_CREATE}
            </code>
            .
          </p>
        }
      >
        <form className="mt-8 max-w-xl space-y-5" onSubmit={(e) => void onSubmit(e)}>
        {error && (
          <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">
            {error}
          </p>
        )}

        <div>
          <label htmlFor="course-title" className="text-sm font-medium text-slate-700">
            Title
          </label>
          <input
            id="course-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={500}
            placeholder="Introduction to Biology"
            className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 shadow-sm outline-none ring-indigo-500/0 transition focus:border-indigo-300 focus:ring-2"
          />
        </div>

        <div>
          <label htmlFor="course-description" className="text-sm font-medium text-slate-700">
            Description
          </label>
          <textarea
            id="course-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            maxLength={20000}
            placeholder="Optional overview for the course catalog."
            className="mt-1.5 w-full resize-y rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 shadow-sm outline-none ring-indigo-500/0 transition focus:border-indigo-300 focus:ring-2"
          />
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'Creating…' : 'Create course'}
          </button>
          <Link
            to="/courses"
            className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50"
          >
            Cancel
          </Link>
        </div>
      </form>
      </RequirePermission>
    </LmsPage>
  )
}
