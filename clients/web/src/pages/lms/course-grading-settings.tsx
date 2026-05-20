import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Plus, Save, Trash2 } from 'lucide-react'
import { useCourseNavFeatures } from '../../context/course-nav-features-context'
import { usePermissions } from '../../context/use-permissions'
import { toastSaveOk } from '../../lib/lms-toast'
import {
  courseItemCreatePermission,
  DEFAULT_LETTER_GRADE_SCALE_JSON,
  fetchCourseGradingScheme,
  fetchCourseGradingSettings,
  fetchCourseStructure,
  GRADING_SCHEME_DISPLAY_TYPES,
  GRADING_SCALE_OPTIONS,
  patchCourseStructureItemAssignmentGroup,
  putCourseGradingScheme,
  putCourseGradingSettings,
  type AssignmentGroup,
  type CourseStructureItem,
} from '../../lib/courses-api'

type EditableGroup = {
  clientKey: string
  id?: string
  name: string
  sortOrder: number
  weightPercent: string
  dropLowest: string
  dropHighest: string
  replaceLowestWithFinal: boolean
}

function newClientKey(): string {
  return `new-${crypto.randomUUID()}`
}

const DEFAULT_SBG_PROFICIENCY_JSON = {
  levels: [
    { level: 4, label: 'Exceeds', minScore: 3.5 },
    { level: 3, label: 'Meets', minScore: 2.5 },
    { level: 2, label: 'Approaching', minScore: 1.5 },
    { level: 1, label: 'Not yet', minScore: 0 },
  ],
}

function groupsToEditable(groups: AssignmentGroup[]): EditableGroup[] {
  return groups.map((g) => ({
    clientKey: g.id,
    id: g.id,
    name: g.name,
    sortOrder: g.sortOrder,
    weightPercent: String(g.weightPercent),
    dropLowest: String(g.dropLowest ?? 0),
    dropHighest: String(g.dropHighest ?? 0),
    replaceLowestWithFinal: g.replaceLowestWithFinal === true,
  }))
}

export function CourseGradingSettingsSection({ courseCode }: { courseCode: string }) {
  const { allows, loading: permLoading } = usePermissions()
  const { refresh: refreshCourseNav } = useCourseNavFeatures()
  const canEdit = !permLoading && allows(courseItemCreatePermission(courseCode))

  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [gradingScale, setGradingScale] = useState('letter_standard')
  const [groups, setGroups] = useState<EditableGroup[]>([])
  const [structure, setStructure] = useState<CourseStructureItem[]>([])
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [itemPatchingId, setItemPatchingId] = useState<string | null>(null)
  const [schemeType, setSchemeType] = useState('points')
  const [schemeJsonText, setSchemeJsonText] = useState('')
  const [passMinPct, setPassMinPct] = useState('60')
  const [completeMinPct, setCompleteMinPct] = useState('50')
  const [sbgEnabled, setSbgEnabled] = useState(false)
  const [sbgRule, setSbgRule] = useState('most_recent')
  const [sbgScaleText, setSbgScaleText] = useState(() => JSON.stringify(DEFAULT_SBG_PROFICIENCY_JSON, null, 2))

  const [initialSettings, setInitialSettings] = useState<{
    gradingScale: string
    assignmentGroups: EditableGroup[]
    sbgEnabled: boolean
    sbgRule: string
    sbgScaleText: string
  } | null>(null)

  const [initialScheme, setInitialScheme] = useState<{
    type: string
    passMinPct: string
    completeMinPct: string
    scaleJsonText: string
  } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [g, items, schemeEnvelope] = await Promise.all([
        fetchCourseGradingSettings(courseCode),
        fetchCourseStructure(courseCode),
        fetchCourseGradingScheme(courseCode),
      ])

      const defaultGroups = [
        {
          clientKey: newClientKey(),
          name: 'Assignments',
          sortOrder: 0,
          weightPercent: '100',
          dropLowest: '0',
          dropHighest: '0',
          replaceLowestWithFinal: false,
        },
      ]
      const loadedGroups = g.assignmentGroups.length > 0
        ? groupsToEditable(g.assignmentGroups)
        : defaultGroups

      const loadedSbgScale = g.sbgProficiencyScaleJson != null
        ? JSON.stringify(g.sbgProficiencyScaleJson, null, 2)
        : JSON.stringify(DEFAULT_SBG_PROFICIENCY_JSON, null, 2)

      const initialS = {
        gradingScale: g.gradingScale,
        assignmentGroups: loadedGroups,
        sbgEnabled: g.sbgEnabled === true,
        sbgRule: g.sbgAggregationRule?.trim() || 'most_recent',
        sbgScaleText: loadedSbgScale,
      }

      setInitialSettings(initialS)
      setGradingScale(initialS.gradingScale)
      setGroups(JSON.parse(JSON.stringify(initialS.assignmentGroups)))
      setSbgEnabled(initialS.sbgEnabled)
      setSbgRule(initialS.sbgRule)
      setSbgScaleText(initialS.sbgScaleText)

      setStructure(items)

      let initialSch: typeof initialScheme
      const sch = schemeEnvelope.scheme
      if (sch) {
        let text = ''
        try {
          text = JSON.stringify(sch.scaleJson ?? {}, null, 2)
        } catch {
          text = '{}'
        }
        let pass = '60'
        let complete = '50'
        const sj = sch.scaleJson as Record<string, unknown> | null
        if (sch.type === 'pass_fail' && sj && typeof sj.pass_min_pct === 'number') {
          pass = String(sj.pass_min_pct)
        }
        if (sch.type === 'complete_incomplete' && sj && typeof sj.complete_min_pct === 'number') {
          complete = String(sj.complete_min_pct)
        }

        initialSch = {
          type: sch.type,
          passMinPct: pass,
          completeMinPct: complete,
          scaleJsonText: text,
        }
      } else {
        initialSch = {
          type: 'points',
          passMinPct: '60',
          completeMinPct: '50',
          scaleJsonText: JSON.stringify(DEFAULT_LETTER_GRADE_SCALE_JSON, null, 2),
        }
      }

      setInitialScheme(initialSch)
      setSchemeType(initialSch.type)
      setSchemeJsonText(initialSch.scaleJsonText)
      setPassMinPct(initialSch.passMinPct)
      setCompleteMinPct(initialSch.completeMinPct)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load grading settings.')
    } finally {
      setLoading(false)
    }
  }, [courseCode])

  useEffect(() => {
    void load()
  }, [load])

  const isSettingsDirty = useMemo(() => {
    if (!initialSettings) return false
    if (initialSettings.gradingScale !== gradingScale) return true
    if (initialSettings.sbgEnabled !== sbgEnabled) return true
    if (sbgEnabled) {
      if (initialSettings.sbgRule !== sbgRule) return true
      if (initialSettings.sbgScaleText !== sbgScaleText) return true
    }
    const cleanInitial = initialSettings.assignmentGroups.map((g) => ({
      name: g.name.trim(),
      weightPercent: String(Number(g.weightPercent) || 0),
      dropLowest: String(Number(g.dropLowest) || 0),
      dropHighest: String(Number(g.dropHighest) || 0),
      replaceLowestWithFinal: g.replaceLowestWithFinal,
    }))
    const cleanCurrent = groups.map((g) => ({
      name: g.name.trim(),
      weightPercent: String(Number(g.weightPercent) || 0),
      dropLowest: String(Number(g.dropLowest) || 0),
      dropHighest: String(Number(g.dropHighest) || 0),
      replaceLowestWithFinal: g.replaceLowestWithFinal,
    }))
    return JSON.stringify(cleanInitial) !== JSON.stringify(cleanCurrent)
  }, [initialSettings, gradingScale, groups, sbgEnabled, sbgRule, sbgScaleText])

  const isSchemeDirty = useMemo(() => {
    if (!initialScheme) return false
    if (initialScheme.type !== schemeType) return true
    if (schemeType === 'letter' || schemeType === 'gpa') {
      let normalInitial = initialScheme.scaleJsonText
      let normalCurrent = schemeJsonText
      try {
        normalInitial = JSON.stringify(JSON.parse(initialScheme.scaleJsonText))
      } catch {
        // Fallback to original text if invalid JSON
      }
      try {
        normalCurrent = JSON.stringify(JSON.parse(schemeJsonText))
      } catch {
        // Fallback to original text if invalid JSON
      }
      if (normalInitial !== normalCurrent) return true
    } else if (schemeType === 'pass_fail') {
      if (initialScheme.passMinPct !== passMinPct) return true
    } else if (schemeType === 'complete_incomplete') {
      if (initialScheme.completeMinPct !== completeMinPct) return true
    }
    return false
  }, [initialScheme, schemeType, schemeJsonText, passMinPct, completeMinPct])

  const isDirty = isSettingsDirty || isSchemeDirty

  const discardChanges = useCallback(() => {
    if (initialSettings) {
      setGradingScale(initialSettings.gradingScale)
      setGroups(JSON.parse(JSON.stringify(initialSettings.assignmentGroups)))
      setSbgEnabled(initialSettings.sbgEnabled)
      setSbgRule(initialSettings.sbgRule)
      setSbgScaleText(initialSettings.sbgScaleText)
    }
    if (initialScheme) {
      setSchemeType(initialScheme.type)
      setSchemeJsonText(initialScheme.scaleJsonText)
      setPassMinPct(initialScheme.passMinPct)
      setCompleteMinPct(initialScheme.completeMinPct)
    }
    setSaveStatus('idle')
    setSaveMessage(null)
  }, [initialSettings, initialScheme])

  async function onSingleSaveChanges() {
    if (!canEdit) return
    setSaveStatus('saving')
    setSaveMessage(null)

    try {
      const promises: Promise<unknown>[] = []

      let sbgProficiencyScaleJson: unknown = undefined
      if (sbgEnabled && isSettingsDirty) {
        try {
          sbgProficiencyScaleJson = JSON.parse(sbgScaleText || '{}')
        } catch {
          setSaveStatus('error')
          setSaveMessage('SBG proficiency scale must be valid JSON.')
          return
        }
      }

      if (isSettingsDirty) {
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
      }

      let scaleJson: unknown = {}
      if (isSchemeDirty) {
        if (schemeType === 'letter' || schemeType === 'gpa') {
          try {
            scaleJson = JSON.parse(schemeJsonText || '[]')
          } catch {
            setSaveStatus('error')
            setSaveMessage('Letter bands must be valid JSON.')
            return
          }
        } else if (schemeType === 'pass_fail') {
          const n = Number.parseFloat(passMinPct)
          scaleJson = { pass_min_pct: Number.isFinite(n) ? n : 60 }
        } else if (schemeType === 'complete_incomplete') {
          const n = Number.parseFloat(completeMinPct)
          scaleJson = { complete_min_pct: Number.isFinite(n) ? n : 50 }
        }
      }

      let savedSettings = false
      let savedScheme = false

      if (isSettingsDirty) {
        savedSettings = true
        promises.push(
          putCourseGradingSettings(courseCode, {
            gradingScale,
            assignmentGroups: groups.map((g, i) => {
              const w = Number.parseFloat(g.weightPercent)
              const dL = Number.parseInt(g.dropLowest, 10)
              const dH = Number.parseInt(g.dropHighest, 10)
              return {
                id: g.id,
                name: g.name.trim(),
                sortOrder: i,
                weightPercent: Number.isFinite(w) ? w : 0,
                dropLowest: Number.isFinite(dL) ? Math.max(0, dL) : 0,
                dropHighest: Number.isFinite(dH) ? Math.max(0, dH) : 0,
                replaceLowestWithFinal: g.replaceLowestWithFinal,
              }
            }),
            sbgEnabled,
            sbgAggregationRule: sbgRule,
            sbgProficiencyScaleJson: sbgEnabled ? sbgProficiencyScaleJson : null,
          })
        )
      }

      if (isSchemeDirty) {
        savedScheme = true
        promises.push(
          putCourseGradingScheme(courseCode, { type: schemeType, scaleJson })
        )
      }

      await Promise.all(promises)
      await load()
      void refreshCourseNav()
      setSaveStatus('saved')
      if (savedScheme) {
        toastSaveOk('Grading scheme saved.')
      }
      if (savedSettings) {
        toastSaveOk('Grading settings saved.')
      }
    } catch (e) {
      setSaveStatus('error')
      setSaveMessage(e instanceof Error ? e.message : 'Could not save configurations.')
    }
  }

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
      else if (it.kind === 'content_page' || it.kind === 'assignment' || it.kind === 'quiz') {
        out.push({ item: it, moduleTitle })
      }
    }
    return out
  }, [structure])

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
        dropLowest: '0',
        dropHighest: '0',
        replaceLowestWithFinal: false,
      },
    ])
  }

  function removeGroup(clientKey: string) {
    setGroups((prev) => prev.filter((g) => g.clientKey !== clientKey))
  }

  if (loading) {
    return <p className="mt-6 text-sm text-slate-500 dark:text-neutral-400">Loading…</p>
  }
  if (loadError) {
    return (
      <p className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-200">
        {loadError}
      </p>
    )
  }

  return (
    <div className="space-y-8">
      <form onSubmit={(e) => e.preventDefault()} className="space-y-6">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-900/5 dark:border-neutral-600 dark:bg-neutral-900 dark:shadow-none">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-neutral-100">Grading scale</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
            Choose how final grades are labeled for this course. This applies when displaying scores
            in the gradebook and to students.
          </p>
          <div className="mt-4 space-y-3">
            {GRADING_SCALE_OPTIONS.map((opt) => (
              <label
                key={opt.id}
                className={`flex cursor-pointer gap-3 rounded-xl border px-3 py-3 text-sm ${
                  gradingScale === opt.id
                    ? 'border-indigo-300 bg-indigo-50/80 dark:border-indigo-500/70 dark:bg-indigo-950/55'
                    : 'border-slate-200 hover:border-slate-300 dark:border-neutral-600 dark:hover:border-neutral-500'
                } ${!canEdit ? 'cursor-not-allowed opacity-70' : ''}`}
              >
                <input
                  type="radio"
                  name="grading-scale"
                  value={opt.id}
                  checked={gradingScale === opt.id}
                  disabled={!canEdit}
                  onChange={() => setGradingScale(opt.id)}
                  className="mt-0.5 h-4 w-4 border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-neutral-500 dark:bg-neutral-800 dark:text-indigo-400 dark:focus:ring-indigo-400"
                />
                <span>
                  <span
                    className={`font-medium ${
                      gradingScale === opt.id
                        ? 'text-slate-900 dark:text-indigo-50'
                        : 'text-slate-900 dark:text-neutral-100'
                    }`}
                  >
                    {opt.label}
                  </span>
                  <span
                    className={`mt-0.5 block ${
                      gradingScale === opt.id
                        ? 'text-slate-500 dark:text-indigo-200/85'
                        : 'text-slate-500 dark:text-neutral-400'
                    }`}
                  >
                    {opt.description}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-900/5 dark:border-neutral-600 dark:bg-neutral-900 dark:shadow-none">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-neutral-100">Grade display scheme</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
            Controls how gradebook and My Grades show scores (letters, pass/fail, etc.). Stored scores stay as
            points; changing this only updates labels.
          </p>
          <div className="mt-4 space-y-4">
            <div>
              <label htmlFor="grading-scheme-type" className="text-xs font-medium text-slate-500 dark:text-neutral-400">
                Display as
              </label>
              <select
                id="grading-scheme-type"
                disabled={!canEdit}
                value={schemeType}
                onChange={(e) => setSchemeType(e.target.value)}
                className="mt-1 w-full max-w-md rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm text-slate-900 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 disabled:opacity-60 dark:border-neutral-600 dark:bg-neutral-950 dark:text-neutral-100 dark:focus:border-indigo-400"
              >
                {GRADING_SCHEME_DISPLAY_TYPES.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            {(schemeType === 'letter' || schemeType === 'gpa') && (
              <div>
                <label htmlFor="grading-scheme-json" className="text-xs font-medium text-slate-500 dark:text-neutral-400">
                  Letter bands (JSON array: label, min_pct, optional gpa)
                </label>
                <textarea
                  id="grading-scheme-json"
                  disabled={!canEdit}
                  value={schemeJsonText}
                  onChange={(e) => setSchemeJsonText(e.target.value)}
                  rows={8}
                  spellCheck={false}
                  className="mt-1 w-full max-w-2xl rounded-lg border border-slate-200 bg-white px-2 py-2 font-mono text-xs text-slate-900 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 disabled:opacity-60 dark:border-neutral-600 dark:bg-neutral-950 dark:text-neutral-100 dark:focus:border-indigo-400"
                />
              </div>
            )}
            {schemeType === 'pass_fail' && (
              <div>
                <label htmlFor="pass-min-pct" className="text-xs font-medium text-slate-500 dark:text-neutral-400">
                  Minimum percent to pass
                </label>
                <input
                  id="pass-min-pct"
                  type="text"
                  inputMode="decimal"
                  disabled={!canEdit}
                  value={passMinPct}
                  onChange={(e) => setPassMinPct(e.target.value)}
                  className="mt-1 w-32 rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm tabular-nums text-slate-900 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 disabled:opacity-60 dark:border-neutral-600 dark:bg-neutral-950 dark:text-neutral-100 dark:focus:border-indigo-400"
                />
              </div>
            )}
            {schemeType === 'complete_incomplete' && (
              <div>
                <label htmlFor="complete-min-pct" className="text-xs font-medium text-slate-500 dark:text-neutral-400">
                  Minimum percent for Complete
                </label>
                <input
                  id="complete-min-pct"
                  type="text"
                  inputMode="decimal"
                  disabled={!canEdit}
                  value={completeMinPct}
                  onChange={(e) => setCompleteMinPct(e.target.value)}
                  className="mt-1 w-32 rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm tabular-nums text-slate-900 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 disabled:opacity-60 dark:border-neutral-600 dark:bg-neutral-950 dark:text-neutral-100 dark:focus:border-indigo-400"
                />
              </div>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-900/5 dark:border-neutral-600 dark:bg-neutral-900 dark:shadow-none">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-neutral-100">Standards-based grading (K–12)</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
            When enabled, you can import course standards, align rubric criteria and quiz questions, and use the
            Standards gradebook. Traditional points and this view can coexist; the points gradebook is unchanged.
          </p>
          <div className="mt-4 space-y-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-800 dark:text-neutral-200">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                disabled={!canEdit}
                checked={sbgEnabled}
                onChange={(e) => setSbgEnabled(e.target.checked)}
              />
              Enable standards-based grading for this course
            </label>
            {sbgEnabled && (
              <>
                <div>
                  <label htmlFor="sbg-rule" className="text-xs font-medium text-slate-500 dark:text-neutral-400">
                    Proficiency aggregation
                  </label>
                  <select
                    id="sbg-rule"
                    disabled={!canEdit}
                    value={sbgRule}
                    onChange={(e) => setSbgRule(e.target.value)}
                    className="mt-1 w-full max-w-md rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-950"
                  >
                    <option value="most_recent">Most recent evidence</option>
                    <option value="highest">Highest</option>
                    <option value="mean">Mean</option>
                    <option value="decaying_average">Decaying average (0.65)</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="sbg-scale" className="text-xs font-medium text-slate-500 dark:text-neutral-400">
                    Proficiency scale (JSON: <code className="text-xs">levels</code> with level, label, minScore)
                  </label>
                  <textarea
                    id="sbg-scale"
                    disabled={!canEdit}
                    value={sbgScaleText}
                    onChange={(e) => setSbgScaleText(e.target.value)}
                    rows={8}
                    spellCheck={false}
                    className="mt-1 w-full max-w-2xl rounded-lg border border-slate-200 bg-white px-2 py-2 font-mono text-xs dark:border-neutral-600 dark:bg-neutral-950"
                  />
                </div>
              </>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-900/5 dark:border-neutral-600 dark:bg-neutral-900 dark:shadow-none">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-neutral-100">Assignment groups & weights</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
            Define categories (for example homework, exams, participation) and what percent of the
            course grade each category represents. Assign each quiz, assignment, or gradable module
            item to a group below.
          </p>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-600 dark:border-neutral-600 dark:text-neutral-400">
                  <th className="pb-2 pr-3 font-medium">Group name</th>
                  <th className="w-28 pb-2 pr-3 font-medium">Weight (%)</th>
                  <th className="w-20 pb-2 pr-2 font-medium" title="Drop this many lowest scores in the group">
                    Drop low
                  </th>
                  <th className="w-20 pb-2 pr-2 font-medium" title="Drop this many highest scores">
                    Drop high
                  </th>
                  <th className="w-28 pb-2 pr-2 font-medium">Replace low</th>
                  <th className="w-10 pb-2" aria-hidden />
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.clientKey} className="border-b border-slate-100 dark:border-neutral-800">
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
                        className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-slate-900 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 disabled:bg-slate-50 dark:border-neutral-600 dark:bg-neutral-950 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:border-indigo-400 dark:disabled:bg-neutral-900"
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
                        className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 tabular-nums text-slate-900 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 disabled:bg-slate-50 dark:border-neutral-600 dark:bg-neutral-950 dark:text-neutral-100 dark:focus:border-indigo-400 dark:disabled:bg-neutral-900"
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={g.dropLowest}
                        disabled={!canEdit}
                        onChange={(e) =>
                          setGroups((prev) =>
                            prev.map((x) =>
                              x.clientKey === g.clientKey ? { ...x, dropLowest: e.target.value } : x,
                            ),
                          )
                        }
                        className="w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2 py-1.5 tabular-nums text-slate-900 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 disabled:bg-slate-50 dark:border-neutral-600 dark:bg-neutral-950 dark:text-neutral-100"
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={g.dropHighest}
                        disabled={!canEdit}
                        onChange={(e) =>
                          setGroups((prev) =>
                            prev.map((x) =>
                              x.clientKey === g.clientKey ? { ...x, dropHighest: e.target.value } : x,
                            ),
                          )
                        }
                        className="w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2 py-1.5 tabular-nums text-slate-900 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 disabled:bg-slate-50 dark:border-neutral-600 dark:bg-neutral-950 dark:text-neutral-100"
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600 dark:text-neutral-400">
                        <input
                           type="checkbox"
                           checked={g.replaceLowestWithFinal}
                           disabled={!canEdit}
                           onChange={(e) =>
                             setGroups((prev) =>
                               prev.map((x) =>
                                 x.clientKey === g.clientKey
                                   ? { ...x, replaceLowestWithFinal: e.target.checked }
                                   : x,
                               ),
                             )
                           }
                           className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-neutral-500"
                        />
                        <span>Final can replace a low score</span>
                      </label>
                    </td>
                    <td className="py-2">
                      {canEdit && groups.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeGroup(g.clientKey)}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:text-neutral-500 dark:hover:bg-rose-950/50 dark:hover:text-rose-400"
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
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:border-slate-400 hover:bg-slate-50 dark:border-neutral-600 dark:text-neutral-300 dark:hover:border-neutral-500 dark:hover:bg-neutral-800/80"
            >
              <Plus className="h-4 w-4" />
              Add group
            </button>
          )}

          <p
            className={`mt-3 text-sm ${
              Math.abs(weightTotal - 100) < 0.01
                ? 'text-emerald-700 dark:text-emerald-400'
                : 'text-amber-800 dark:text-amber-300'
            }`}
          >
            Weights sum to{' '}
            <span className="font-semibold tabular-nums">{weightTotal.toFixed(2)}%</span>
            {Math.abs(weightTotal - 100) >= 0.01 && (
              <span className="ml-1">— usually this should total 100%.</span>
            )}
          </p>
        </section>

        {!canEdit && (
          <p className="text-sm text-slate-500 dark:text-neutral-400">
            You can view these settings; only course editors can change grading.
          </p>
        )}
      </form>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-900/5 dark:border-neutral-600 dark:bg-neutral-900 dark:shadow-none">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-neutral-100">Gradable items</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
          Assign each quiz, assignment, or gradable content page to an assignment group. Items without a
          group do not count toward weighted categories until you assign one.
        </p>

        {gradableRows.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500 dark:text-neutral-400">
            No quizzes, assignments, or gradable content pages yet. Add them in{' '}
            <span className="font-medium text-slate-700 dark:text-neutral-200">Modules</span>.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[32rem] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-600 dark:border-neutral-600 dark:text-neutral-400">
                  <th className="pb-2 pr-3 font-medium">Item</th>
                  <th className="w-32 pb-2 pr-3 font-medium">Type</th>
                  <th className="pb-2 font-medium">Assignment group</th>
                </tr>
              </thead>
              <tbody>
                {gradableRows.map(({ item, moduleTitle }) => (
                  <tr key={item.id} className="border-b border-slate-100 dark:border-neutral-800">
                    <td className="py-2 pr-3">
                      <div className="text-slate-500 dark:text-neutral-400">{moduleTitle}</div>
                      <div className="font-medium text-slate-900 dark:text-neutral-100">{item.title}</div>
                    </td>
                    <td className="py-2 pr-3 capitalize text-slate-600 dark:text-neutral-400">
                      {item.kind === 'content_page' ? 'Content' : item.kind === 'quiz' ? 'Quiz' : 'Assignment'}
                    </td>
                    <td className="py-2">
                      <select
                        value={item.assignmentGroupId ?? ''}
                        disabled={!canEdit || itemPatchingId === item.id}
                        onChange={(e) => void onItemGroupChange(item.id, e.target.value)}
                        className="w-full max-w-xs rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-slate-900 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-600 dark:bg-neutral-950 dark:text-neutral-100 dark:focus:border-indigo-400"
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

      {isDirty && (
        <div className="fixed bottom-6 left-1/2 z-50 w-full max-w-2xl -translate-x-1/2 px-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white/90 px-6 py-4 shadow-xl backdrop-blur-md dark:border-neutral-800 dark:bg-neutral-900/90">
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-slate-900 dark:text-neutral-50">Unsaved changes</span>
              <span className="text-xs text-slate-500 dark:text-neutral-400">
                {saveStatus === 'error' && saveMessage ? (
                  <span className="text-rose-600 dark:text-rose-400 font-medium">{saveMessage}</span>
                ) : (
                  "You have modified this course's grading settings."
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
    </div>
  )
}
