import { useCallback, useEffect, useId, useState } from 'react'
import { Save } from 'lucide-react'
import { authorizedFetch } from '../../lib/api'
import { readApiErrorMessage } from '../../lib/errors'
import { toastMutationError, toastSaveOk } from '../../lib/lms-toast'
import { subscribeToPush, getExistingPushSubscription } from '../../lib/push-notifications'

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

const STORYBOOK_MOCK_ROWS: PreferenceRow[] = [
  { eventType: 'grade_posted', emailEnabled: true, pushEnabled: true, digestMode: 'instant' },
  { eventType: 'assignment_created', emailEnabled: true, pushEnabled: true, digestMode: 'daily' },
  { eventType: 'discussion_reply', emailEnabled: false, pushEnabled: true, digestMode: 'off' },
]

export function NotificationPreferencesPanel() {
  const baseId = useId()
  const [rows, setRows] = useState<PreferenceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [pushSubscribed, setPushSubscribed] = useState(false)
  const [pushLoading, setPushLoading] = useState(false)

  const load = useCallback(async () => {
    if (import.meta.env.STORYBOOK === 'true') {
      setRows(STORYBOOK_MOCK_ROWS)
      setLoading(false)
      return
    }
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
    if (import.meta.env.STORYBOOK !== 'true') {
      void getExistingPushSubscription().then((sub) => setPushSubscribed(!!sub))
    }
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

  const enablePush = async () => {
    setPushLoading(true)
    try {
      const sub = await subscribeToPush()
      if (sub) {
        setPushSubscribed(true)
        toastSaveOk('Push notifications enabled.')
      } else {
        toastMutationError('Could not enable push notifications. Check browser permissions.')
      }
    } finally {
      setPushLoading(false)
    }
  }

  if (loading) {
    return <p className="mt-4 text-sm text-slate-500">Loading notification preferences…</p>
  }

  return (
    <div>
      <p className="mt-2 text-sm text-slate-600 dark:text-neutral-400">
        Choose which events send you notifications.
      </p>

      {/* Push enable banner */}
      {!pushSubscribed && 'Notification' in window && (
        <div className="mt-4 flex items-center justify-between rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 dark:border-indigo-800 dark:bg-indigo-950/30">
          <div>
            <p className="text-sm font-medium text-indigo-900 dark:text-indigo-200">Enable browser push notifications</p>
            <p className="text-xs text-indigo-700 dark:text-indigo-400">Get real-time alerts even when the tab is in the background.</p>
          </div>
          <button
            type="button"
            onClick={() => void enablePush()}
            disabled={pushLoading}
            className="shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {pushLoading ? 'Enabling…' : 'Enable push'}
          </button>
        </div>
      )}

      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 dark:border-neutral-700">
        <table className="min-w-full text-sm" data-testid="notification-preferences-table">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600 dark:bg-neutral-800 dark:text-neutral-300">
            <tr>
              <th className="px-4 py-3" scope="col">
                Event
              </th>
              <th className="px-4 py-3" scope="col">
                Email
              </th>
              <th className="px-4 py-3" scope="col">
                Push
              </th>
              <th className="px-4 py-3" scope="col">
                Delivery
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-neutral-800">
            {rows.map((row) => {
              const emailId = `${baseId}-${row.eventType}-email`
              const pushId = `${baseId}-${row.eventType}-push`
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
                    <label htmlFor={pushId} className="sr-only">
                      Push for {label}
                    </label>
                    <button
                      id={pushId}
                      type="button"
                      role="switch"
                      aria-checked={row.pushEnabled}
                      onClick={() =>
                        updateRow(row.eventType, { pushEnabled: !row.pushEnabled })
                      }
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                        row.pushEnabled ? 'bg-indigo-600' : 'bg-slate-200 dark:bg-neutral-600'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                          row.pushEnabled ? 'translate-x-5' : 'translate-x-0'
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
