import { useCallback, useEffect, useId, useState } from 'react'
import { Save } from 'lucide-react'
import { authorizedFetch } from '../../lib/api'
import { readApiErrorMessage } from '../../lib/errors'
import { toastMutationError, toastSaveOk } from '../../lib/lms-toast'

type PreferenceRow = {
  eventType: string
  emailEnabled: boolean
  pushEnabled: boolean
  digestMode: 'instant' | 'daily' | 'off'
}

const EVENT_LABELS: Record<string, string> = {
  grade_posted: 'Grade posted',
  assignment_created: 'New assignment',
  discussion_reply: 'Discussion reply',
  course_announcement: 'Course announcement',
  submission_received: 'Submission received',
  assignment_due_reminder: 'Assignment due reminder',
  password_reset: 'Password reset',
  welcome_invite: 'Welcome / invite',
}

const DIGEST_OPTIONS: { value: PreferenceRow['digestMode']; label: string }[] = [
  { value: 'instant', label: 'Instant email' },
  { value: 'daily', label: 'Daily digest' },
  { value: 'off', label: 'Off' },
]

export function NotificationPreferencesPanel() {
  const baseId = useId()
  const [rows, setRows] = useState<PreferenceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await authorizedFetch('/api/v1/me/notification-preferences')
      const raw: unknown = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(readApiErrorMessage(raw))
      }
      const list = (raw as { preferences?: PreferenceRow[] }).preferences ?? []
      setRows(list)
    } catch (e) {
      toastMutationError(e instanceof Error ? e.message : 'Could not load preferences.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const updateRow = (eventType: string, patch: Partial<PreferenceRow>) => {
    setRows((prev) =>
      prev.map((r) => (r.eventType === eventType ? { ...r, ...patch } : r)),
    )
  }

  const save = async () => {
    setSaving(true)
    try {
      const res = await authorizedFetch('/api/v1/me/notification-preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: rows }),
      })
      const raw: unknown = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(readApiErrorMessage(raw))
      }
      const list = (raw as { preferences?: PreferenceRow[] }).preferences ?? []
      setRows(list)
      toastSaveOk('Notification preferences saved.')
    } catch (e) {
      toastMutationError(e instanceof Error ? e.message : 'Could not save preferences.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <p className="mt-4 text-sm text-slate-500">Loading notification preferences…</p>
  }

  return (
    <div>
      <p className="mt-2 text-sm text-slate-600 dark:text-neutral-400">
        Choose which events send you email. Push notifications will be available in a future update.
      </p>
      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 dark:border-neutral-700">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600 dark:bg-neutral-800 dark:text-neutral-300">
            <tr>
              <th className="px-4 py-3" scope="col">
                Event
              </th>
              <th className="px-4 py-3" scope="col">
                Email
              </th>
              <th className="px-4 py-3" scope="col">
                Delivery
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-neutral-800">
            {rows.map((row) => {
              const emailId = `${baseId}-${row.eventType}-email`
              const digestId = `${baseId}-${row.eventType}-digest`
              const label = EVENT_LABELS[row.eventType] ?? row.eventType
              return (
                <tr key={row.eventType} className="bg-white dark:bg-neutral-900">
                  <td className="px-4 py-3 font-medium text-slate-900 dark:text-neutral-100">
                    {label}
                  </td>
                  <td className="px-4 py-3">
                    <label htmlFor={emailId} className="sr-only">
                      Email for {label}
                    </label>
                    <button
                      id={emailId}
                      type="button"
                      role="switch"
                      aria-checked={row.emailEnabled}
                      onClick={() =>
                        updateRow(row.eventType, { emailEnabled: !row.emailEnabled })
                      }
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                        row.emailEnabled ? 'bg-indigo-600' : 'bg-slate-200 dark:bg-neutral-600'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                          row.emailEnabled ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <label htmlFor={digestId} className="sr-only">
                      Delivery for {label}
                    </label>
                    <select
                      id={digestId}
                      value={row.digestMode}
                      disabled={!row.emailEnabled}
                      onChange={(e) =>
                        updateRow(row.eventType, {
                          digestMode: e.target.value as PreferenceRow['digestMode'],
                        })
                      }
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-neutral-600 dark:bg-neutral-900"
                    >
                      {DIGEST_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          <Save className="h-4 w-4" aria-hidden />
          {saving ? 'Saving…' : 'Save preferences'}
        </button>
      </div>
    </div>
  )
}
