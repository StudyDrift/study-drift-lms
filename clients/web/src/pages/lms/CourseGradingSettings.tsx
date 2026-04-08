import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { usePermissions } from '../../context/PermissionsContext'
import {
  courseItemCreatePermission,
  fetchCourseGradingSettings,
  fetchCourseStructure,
  GRADING_SCALE_OPTIONS,
  patchCourseStructureItemAssignmentGroup,
  putCourseGradingSettings,
  type AssignmentGroup,
  type CourseStructureItem,
} from '../../lib/coursesApi'

type EditableGroup = {
  clientKey: string
  id?: string
  name: string
  sortOrder: number
  weightPercent: string
}

function newClientKey(): string {
  return `new-${crypto.randomUUID()}`
}

function groupsToEditable(groups: AssignmentGroup[]): EditableGroup[] {
  return groups.map((g) => ({
    clientKey: g.id,
    id: g.id,
    name: g.name,
    sortOrder: g.sortOrder,
    weightPercent: String(g.weightPercent),
  }))
}

export function CourseGradingSettingsSection({ courseCode }: { courseCode: string }) {
  const { allows, loading: permLoading } = usePermissions()
  const canEdit = !permLoading && allows(courseItemCreatePermission(courseCode))

  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [gradingScale, setGradingScale] = useState('letter_standard')
  const [groups, setGroups] = useState<EditableGroup[]>([])
  const [structure, setStructure] = useState<CourseStructureItem[]>([])
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [itemPatchingId, setItemPatchingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [g, items] = await Promise.all([
        fetchCourseGradingSettings(courseCode),
        fetchCourseStructure(courseCode),
      ])
      setGradingScale(g.gradingScale)
      setGroups(
        g.assignmentGroups.length > 0
          ? groupsToEditable(g.assignmentGroups)
          : [
              {
                clientKey: newClientKey(),
                name: 'Assignments',
                sortOrder: 0,
                weightPercent: '100',
              },
            ],
      )
      setStructure(items)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load grading settings.')
    } finally {
      setLoading(false)
    }
  }, [courseCode])

  useEffect(() => {
    void load()
  }, [load])

  const weightTotal = useMemo(() => {
    let t = 0
    for (const g of groups) {
      const n = Number.parseFloat(g.weightPercent)
      if (Number.isFinite(n)) t += n
    }
    return Math.round(t * 1000) / 1000
  }, [groups])

  const gradableRows = useMemo(() => {
    const out: { item: CourseStructureItem; moduleTitle: string }[] = []
    let moduleTitle = ''
    for (const it of structure) {
      if (it.kind === 'module') moduleTitle = it.title
      else if (it.kind === 'content_page' || it.kind === 'assignment') {
        out.push({ item: it, moduleTitle })
      }
    }
    return out
  }, [structure])

  async function onSaveGrading(e: React.FormEvent) {
    e.preventDefault()
    if (!canEdit) return
    const named = groups.filter((g) => g.name.trim())
    if (named.length === 0) {
      setSaveStatus('error')
      setSaveMessage('Add at least one assignment group with a name, or remove extra rows.')
      return
    }
    if (named.length !== groups.length) {
      setSaveStatus('error')
      setSaveMessage('Each assignment group needs a name.')
      return
    }
    setSaveStatus('saving')
    setSaveMessage(null)
    try {
      const payload = await putCourseGradingSettings(courseCode, {
        gradingScale,
        assignmentGroups: groups.map((g, i) => {
          const w = Number.parseFloat(g.weightPercent)
          return {
            id: g.id,
            name: g.name.trim(),
            sortOrder: i,
            weightPercent: Number.isFinite(w) ? w : 0,
          }
        }),
      })
      setGradingScale(payload.gradingScale)
      setGroups(groupsToEditable(payload.assignmentGroups))
      const items = await fetchCourseStructure(courseCode)
      setStructure(items)
      setSaveStatus('saved')
      setSaveMessage('Grading settings saved.')
    } catch (e) {
      setSaveStatus('error')
      setSaveMessage(e instanceof Error ? e.message : 'Could not save.')
    }
  }

  async function onItemGroupChange(itemId: string, value: string) {
    if (!canEdit) return
    const assignmentGroupId = value === '' ? null : value
    setItemPatchingId(itemId)
    try {
      const updated = await patchCourseStructureItemAssignmentGroup(courseCode, itemId, assignmentGroupId)
      setStructure((prev) => prev.map((row) => (row.id === updated.id ? updated : row)))
    } catch (e) {
      setSaveMessage(e instanceof Error ? e.message : 'Could not update item.')
      setSaveStatus('error')
    } finally {
      setItemPatchingId(null)
    }
  }

  function addGroup() {
    setGroups((prev) => [
      ...prev,
      {
        clientKey: newClientKey(),
        name: '',
        sortOrder: prev.length,
        weightPercent: '0',
      },
    ])
  }

  function removeGroup(clientKey: string) {
    setGroups((prev) => prev.filter((g) => g.clientKey !== clientKey))
  }

  if (loading) {
    return <p className="mt-6 text-sm text-slate-500">Loading…</p>
  }
  if (loadError) {
    return (
      <p className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
        {loadError}
      </p>
    )
  }

  return (
    <div className="space-y-8">
      <form onSubmit={onSaveGrading} className="space-y-6">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-900/5">
          <h2 className="text-sm font-semibold text-slate-900">Grading scale</h2>
          <p className="mt-1 text-sm text-slate-500">
            Choose how final grades are labeled for this course. This applies when displaying scores
            in the gradebook and to students.
          </p>
          <div className="mt-4 space-y-3">
            {GRADING_SCALE_OPTIONS.map((opt) => (
              <label
                key={opt.id}
                className={`flex cursor-pointer gap-3 rounded-xl border px-3 py-3 text-sm ${
                  gradingScale === opt.id
                    ? 'border-indigo-300 bg-indigo-50/80'
                    : 'border-slate-200 hover:border-slate-300'
                } ${!canEdit ? 'cursor-not-allowed opacity-70' : ''}`}
              >
                <input
                  type="radio"
                  name="grading-scale"
                  value={opt.id}
                  checked={gradingScale === opt.id}
                  disabled={!canEdit}
                  onChange={() => setGradingScale(opt.id)}
                  className="mt-0.5 h-4 w-4 border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span>
                  <span className="font-medium text-slate-900">{opt.label}</span>
                  <span className="mt-0.5 block text-slate-500">{opt.description}</span>
                </span>
              </label>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-900/5">
          <h2 className="text-sm font-semibold text-slate-900">Assignment groups & weights</h2>
          <p className="mt-1 text-sm text-slate-500">
            Define categories (for example homework, exams, participation) and what percent of the
            course grade each category represents. Assign each quiz, assignment, or gradable module
            item to a group below.
          </p>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[28rem] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-600">
                  <th className="pb-2 pr-3 font-medium">Group name</th>
                  <th className="w-28 pb-2 pr-3 font-medium">Weight (%)</th>
                  <th className="w-10 pb-2" aria-hidden />
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.clientKey} className="border-b border-slate-100">
                    <td className="py-2 pr-3">
                      <input
                        type="text"
                        value={g.name}
                        disabled={!canEdit}
                        onChange={(e) =>
                          setGroups((prev) =>
                            prev.map((x) =>
                              x.clientKey === g.clientKey ? { ...x, name: e.target.value } : x,
                            ),
                          )
                        }
                        placeholder="e.g. Homework"
                        className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-slate-900 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 disabled:bg-slate-50"
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={g.weightPercent}
                        disabled={!canEdit}
                        onChange={(e) =>
                          setGroups((prev) =>
                            prev.map((x) =>
                              x.clientKey === g.clientKey ? { ...x, weightPercent: e.target.value } : x,
                            ),
                          )
                        }
                        className="w-full rounded-lg border border-slate-200 px-2 py-1.5 tabular-nums text-slate-900 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 disabled:bg-slate-50"
                      />
                    </td>
                    <td className="py-2">
                      {canEdit && groups.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeGroup(g.clientKey)}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                          aria-label="Remove group"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {canEdit && (
            <button
              type="button"
              onClick={addGroup}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:border-slate-400 hover:bg-slate-50"
            >
              <Plus className="h-4 w-4" />
              Add group
            </button>
          )}

          <p
            className={`mt-3 text-sm ${Math.abs(weightTotal - 100) < 0.01 ? 'text-emerald-700' : 'text-amber-800'}`}
          >
            Weights sum to{' '}
            <span className="font-semibold tabular-nums">{weightTotal.toFixed(2)}%</span>
            {Math.abs(weightTotal - 100) >= 0.01 && (
              <span className="ml-1">— usually this should total 100%.</span>
            )}
          </p>
        </section>

        {saveMessage && (
          <p
            className={saveStatus === 'error' ? 'text-sm text-rose-700' : 'text-sm text-emerald-700'}
            role="status"
          >
            {saveMessage}
          </p>
        )}

        {canEdit && (
          <button
            type="submit"
            disabled={saveStatus === 'saving'}
            className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saveStatus === 'saving' ? 'Saving…' : 'Save grading settings'}
          </button>
        )}

        {!canEdit && (
          <p className="text-sm text-slate-500">
            You can view these settings; only course editors can change grading.
          </p>
        )}
      </form>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-900/5">
        <h2 className="text-sm font-semibold text-slate-900">Gradable items</h2>
        <p className="mt-1 text-sm text-slate-500">
          Assign each assignment or content page to an assignment group. Items without a group do not
          count toward weighted categories until you assign one.
        </p>

        {gradableRows.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">
            No assignments or content pages yet. Add them in{' '}
            <span className="font-medium text-slate-700">Modules</span>.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[32rem] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-600">
                  <th className="pb-2 pr-3 font-medium">Item</th>
                  <th className="w-32 pb-2 pr-3 font-medium">Type</th>
                  <th className="pb-2 font-medium">Assignment group</th>
                </tr>
              </thead>
              <tbody>
                {gradableRows.map(({ item, moduleTitle }) => (
                  <tr key={item.id} className="border-b border-slate-100">
                    <td className="py-2 pr-3">
                      <div className="text-slate-500">{moduleTitle}</div>
                      <div className="font-medium text-slate-900">{item.title}</div>
                    </td>
                    <td className="py-2 pr-3 capitalize text-slate-600">
                      {item.kind === 'content_page' ? 'Content' : 'Assignment'}
                    </td>
                    <td className="py-2">
                      <select
                        value={item.assignmentGroupId ?? ''}
                        disabled={!canEdit || itemPatchingId === item.id}
                        onChange={(e) => void onItemGroupChange(item.id, e.target.value)}
                        className="w-full max-w-xs rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-slate-900 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <option value="">— None —</option>
                        {groups
                          .filter((g) => g.name.trim() && g.id)
                          .map((g) => (
                            <option key={g.clientKey} value={g.id!}>
                              {g.name.trim()}
                            </option>
                          ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
