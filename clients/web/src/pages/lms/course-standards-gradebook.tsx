import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { usePermissions } from '../../context/use-permissions'
import { apiUrl } from '../../lib/api'
import { getAccessToken } from '../../lib/auth'
import {
  courseGradebookViewPermission,
  courseItemCreatePermission,
  fetchSbgStandardsGradebook,
  importSbgStandardsCsv,
  type SbgStandardsGradebookResponse,
} from '../../lib/courses-api'
import { MasteryLabelCell } from '../../components/grading/mastery-heatmap'
import { GradebookLoadingSkeleton } from '../../components/ui/lms-content-skeletons'
import { LmsPage } from './lms-page'
import { toastSaveOk } from '../../lib/lms-toast'

function profLabel(
  d: SbgStandardsGradebookResponse,
  studentId: string,
  standardId: string,
): string {
  return (
    d.proficiencies.find(
      (p) => p.studentUserId === studentId && p.standardId === standardId,
    )?.levelLabel ?? '—'
  )
}

export default function CourseStandardsGradebook() {
  const { courseCode: raw } = useParams()
  const courseCode = raw ? decodeURIComponent(raw) : ''
  const { allows, loading: permsLoading } = usePermissions()
  const canView = !permsLoading && allows(courseGradebookViewPermission(courseCode))
  const canManage = !permsLoading && allows(courseItemCreatePermission(courseCode))

  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [data, setData] = useState<SbgStandardsGradebookResponse | null>(null)
  const [importMsg, setImportMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!courseCode) return
    setLoading(true)
    setErr(null)
    try {
      const d = await fetchSbgStandardsGradebook(courseCode)
      setData(d)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load standards gradebook.')
    } finally {
      setLoading(false)
    }
  }, [courseCode])

  useEffect(() => {
    void load()
  }, [load])

  async function onImportFile(f: File | null) {
    if (!f || !canManage) return
    setImportMsg(null)
    const text = await f.text()
    try {
      await importSbgStandardsCsv(courseCode, text)
      setImportMsg('Import complete. Proficiencies are recomputing.')
      await load()
      toastSaveOk()
    } catch (e) {
      setImportMsg(e instanceof Error ? e.message : 'Import failed.')
    }
  }

  async function downloadTranscriptPdf(studentId: string) {
    const url = apiUrl(
      `/api/v1/courses/${encodeURIComponent(courseCode)}/students/${encodeURIComponent(studentId)}/mastery-transcript.pdf`,
    )
    const token = getAccessToken()
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!res.ok) {
      setErr('Could not download mastery transcript PDF.')
      return
    }
    const blob = await res.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'mastery-transcript.pdf'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  if (!courseCode) {
    return null
  }

  return (
    <LmsPage title="Standards gradebook">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600 dark:text-neutral-400">
          Per-student proficiency labels on each course standard. Columns are standards; rows are
          students.
        </p>
        {canManage && (
          <label className="text-sm text-indigo-600 dark:text-indigo-300">
            <span className="sr-only">Import standards CSV</span>
            <input
              type="file"
              accept=".csv,text/csv"
              className="text-xs file:mr-2 file:rounded file:border-0 file:bg-indigo-100 file:px-2 file:py-1 file:text-sm dark:file:bg-indigo-900/80"
              onChange={(e) => void onImportFile(e.target.files?.[0] ?? null)}
            />
          </label>
        )}
      </div>
      {importMsg && <p className="mb-2 text-sm text-slate-600 dark:text-neutral-400">{importMsg}</p>}
      {!canView && !permsLoading && (
        <p className="text-sm text-amber-800 dark:text-amber-200">You don&apos;t have access to this page.</p>
      )}
      {err && <p className="text-sm text-rose-700 dark:text-rose-300">{err}</p>}
      {loading && <GradebookLoadingSkeleton />}
      {data && canView && (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-neutral-600 dark:bg-neutral-900">
          <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-neutral-600">
                <th className="sticky left-0 z-10 bg-white px-2 py-2 font-medium dark:bg-neutral-900">
                  Student
                </th>
                {data.standards.map((s) => (
                  <th
                    key={s.id}
                    className="min-w-[6rem] px-1 py-2 text-center text-xs font-medium text-slate-600 dark:text-neutral-400"
                    title={s.description}
                  >
                    {s.externalId || s.id.slice(0, 6)}
                  </th>
                ))}
                <th className="px-2 py-2 text-right text-xs font-medium text-slate-500">Transcript</th>
              </tr>
            </thead>
            <tbody>
              {data.students.map((stu) => (
                <tr
                  key={stu.userId}
                  className="border-b border-slate-100 dark:border-neutral-800"
                >
                  <td className="sticky left-0 z-10 bg-white px-2 py-1 text-slate-900 dark:bg-neutral-900 dark:text-neutral-100">
                    {stu.displayLabel}
                  </td>
                  {data.standards.map((s) => (
                    <MasteryLabelCell
                      key={`${stu.userId}-${s.id}`}
                      label={profLabel(data, stu.userId, s.id)}
                      studentName={stu.displayLabel}
                      standardCode={s.externalId || s.id}
                    />
                  ))}
                  <td className="px-2 text-right">
                    <button
                      type="button"
                      className="text-xs text-indigo-600 underline dark:text-indigo-300"
                      onClick={() => void downloadTranscriptPdf(stu.userId)}
                    >
                      PDF
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </LmsPage>
  )
}
