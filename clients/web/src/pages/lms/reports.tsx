import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BarChart3 } from 'lucide-react'
import { RequirePermission } from '../../components/require-permission'
import { LmsPage } from './lms-page'
import { fetchLearningActivityReport, type LearningActivityReport } from '../../lib/reports-api'
import { PERM_REPORTS_VIEW } from '../../lib/rbac-api'

type Preset = '7d' | '30d' | '90d'

function utcRange(preset: Preset): { from: string; to: string } {
  const to = new Date()
  const from = new Date(to)
  const days = preset === '7d' ? 7 : preset === '30d' ? 30 : 90
  from.setUTCDate(from.getUTCDate() - days)
  return { from: from.toISOString(), to: to.toISOString() }
}

function eventKindLabel(kind: string): string {
  switch (kind) {
    case 'course_visit':
      return 'Course visit'
    case 'content_open':
      return 'Content opened'
    case 'content_leave':
      return 'Content left'
    default:
      return kind
  }
}

function formatDay(isoDate: string): string {
  const d = new Date(isoDate + 'T00:00:00Z')
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatRange(from: string, to: string): string {
  const a = new Date(from)
  const b = new Date(to)
  const opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }
  return `${a.toLocaleString(undefined, opts)} → ${b.toLocaleString(undefined, opts)}`
}

export default function Reports() {
  const [preset, setPreset] = useState<Preset>('30d')
  const [report, setReport] = useState<LearningActivityReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (p: Preset) => {
    setLoading(true)
    setError(null)
    const r = utcRange(p)
    try {
      const data = await fetchLearningActivityReport(r)
      setReport(data)
    } catch (e) {
      setReport(null)
      setError(e instanceof Error ? e.message : 'Could not load report.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(preset)
  }, [load, preset])

  const maxDayTotal = useMemo(() => {
    if (!report?.byDay.length) return 1
    return Math.max(
      ...report.byDay.map((d) => d.courseVisit + d.contentOpen + d.contentLeave),
      1,
    )
  }, [report])

  const kindTotal = useMemo(() => {
    if (!report?.byEventKind.length) return 1
    return report.byEventKind.reduce((s, k) => s + k.count, 0) || 1
  }, [report])

  return (
    <LmsPage
      title="Reports"
      description="Learning activity from course visits and module content engagement (user audit)."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {(['7d', '30d', '90d'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPreset(p)}
              className={`rounded-xl border px-3 py-2 text-sm font-semibold shadow-sm transition ${
                preset === p
                  ? 'border-indigo-300 bg-indigo-50 text-indigo-900 dark:border-indigo-500/50 dark:bg-indigo-950/60 dark:text-indigo-100'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-indigo-200 hover:bg-indigo-50/60 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:border-indigo-500/40 dark:hover:bg-indigo-950/40'
              }`}
            >
              {p === '7d' ? '7 days' : p === '30d' ? '30 days' : '90 days'}
            </button>
          ))}
        </div>
      }
    >
      <RequirePermission
        permission={PERM_REPORTS_VIEW}
        fallback={
          <p className="mt-8 max-w-xl rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200">
            You do not have permission to view reports. Ask an administrator to grant{' '}
            <code className="rounded bg-slate-200/80 px-1.5 py-0.5 font-mono text-xs dark:bg-neutral-800">
              {PERM_REPORTS_VIEW}
            </code>
            .
          </p>
        }
      >
        {loading && (
          <p className="mt-8 text-sm text-slate-500 dark:text-neutral-400" aria-live="polite">
            Loading report…
          </p>
        )}
        {error && (
          <p
            className="mt-8 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-100"
            role="alert"
          >
            {error}
          </p>
        )}
        {!loading && !error && report && (
          <div className="mt-8 space-y-10">
            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600 dark:text-neutral-400">
              <BarChart3 className="h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-400" aria-hidden />
              <span className="tabular-nums">{formatRange(report.range.from, report.range.to)}</span>
              <span className="text-slate-400 dark:text-neutral-500">(UTC)</span>
            </div>

            <section>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-neutral-100">Summary</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-950">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-neutral-400">
                    Total events
                  </p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900 dark:text-neutral-100">
                    {report.summary.totalEvents.toLocaleString()}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-950">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-neutral-400">
                    Active learners
                  </p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900 dark:text-neutral-100">
                    {report.summary.uniqueUsers.toLocaleString()}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-950">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-neutral-400">
                    Courses with activity
                  </p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900 dark:text-neutral-100">
                    {report.summary.uniqueCourses.toLocaleString()}
                  </p>
                </div>
              </div>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-neutral-100">Activity by day</h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
                Stacked daily totals (course visits, content opens, content leaves).
              </p>
              {report.byDay.length === 0 ? (
                <p className="mt-4 text-sm text-slate-600 dark:text-neutral-400">No events in this range.</p>
              ) : (
                <div className="mt-4 flex max-h-80 flex-col gap-2 overflow-y-auto pr-1">
                  {report.byDay.map((row) => {
                    const total = row.courseVisit + row.contentOpen + row.contentLeave
                    const barPct = maxDayTotal > 0 ? (total / maxDayTotal) * 100 : 0
                    const seg = (n: number) => (total > 0 ? n : 0)
                    return (
                      <div key={row.day} className="flex min-h-[28px] items-center gap-3 text-sm">
                        <span className="w-28 shrink-0 text-slate-600 tabular-nums dark:text-neutral-400">
                          {formatDay(row.day)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex h-7 w-full rounded-lg bg-slate-100 dark:bg-neutral-800">
                            <div
                              className="flex h-full min-w-0 flex-row overflow-hidden rounded-lg"
                              style={{ width: `${barPct}%` }}
                              title={`${total} events`}
                            >
                              <div className="h-full min-w-0 bg-indigo-500" style={{ flex: seg(row.courseVisit) }} />
                              <div className="h-full min-w-0 bg-emerald-500" style={{ flex: seg(row.contentOpen) }} />
                              <div className="h-full min-w-0 bg-amber-400" style={{ flex: seg(row.contentLeave) }} />
                            </div>
                          </div>
                        </div>
                        <span className="w-10 shrink-0 text-right tabular-nums text-slate-700 dark:text-neutral-200">
                          {total}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
              <div className="mt-4 flex flex-wrap gap-4 text-xs text-slate-600 dark:text-neutral-400">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-4 rounded bg-indigo-500" /> Course visit
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-4 rounded bg-emerald-500" /> Content opened
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-4 rounded bg-amber-400" /> Content left
                </span>
              </div>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-neutral-100">Events by type</h2>
              {report.byEventKind.length === 0 ? (
                <p className="mt-4 text-sm text-slate-600 dark:text-neutral-400">No events in this range.</p>
              ) : (
                <ul className="mt-4 space-y-3">
                  {report.byEventKind.map((k) => (
                    <li key={k.eventKind}>
                      <div className="flex items-center justify-between gap-4 text-sm">
                        <span className="text-slate-700 dark:text-neutral-300">{eventKindLabel(k.eventKind)}</span>
                        <span className="tabular-nums text-slate-900 dark:text-neutral-100">
                          {k.count.toLocaleString()} (
                          {Math.round((k.count / kindTotal) * 100)}%)
                        </span>
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-neutral-800">
                        <div
                          className="h-full rounded-full bg-indigo-500"
                          style={{ width: `${(k.count / kindTotal) * 100}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-neutral-100">Top courses</h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
                By total audit events in the selected range.
              </p>
              {report.topCourses.length === 0 ? (
                <p className="mt-4 text-sm text-slate-600 dark:text-neutral-400">No course activity in this range.</p>
              ) : (
                <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-950">
                  <table className="min-w-full text-left text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:border-neutral-700 dark:bg-neutral-800/80 dark:text-neutral-300">
                      <tr>
                        <th className="px-4 py-3">Course</th>
                        <th className="px-4 py-3">Code</th>
                        <th className="px-4 py-3 text-right">Events</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-neutral-800">
                      {report.topCourses.map((c) => (
                        <tr key={c.courseId} className="hover:bg-slate-50/80 dark:hover:bg-neutral-800/80">
                          <td className="px-4 py-3 font-medium text-slate-900 dark:text-neutral-100">
                            <Link
                              to={`/courses/${encodeURIComponent(c.courseCode)}`}
                              className="text-indigo-600 underline-offset-2 hover:underline dark:text-indigo-400 dark:hover:text-indigo-300"
                            >
                              {c.title}
                            </Link>
                          </td>
                          <td className="px-4 py-3 text-slate-600 dark:text-neutral-400">{c.courseCode}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-slate-900 dark:text-neutral-100">
                            {c.eventCount.toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}
      </RequirePermission>
    </LmsPage>
  )
}
