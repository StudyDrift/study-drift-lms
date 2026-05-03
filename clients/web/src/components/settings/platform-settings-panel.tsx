import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { authorizedFetch } from '../../lib/api'
import { readApiErrorMessage } from '../../lib/errors'
import { PLATFORM_SECRET_PLACEHOLDER } from '../../lib/platform-settings'
import { toastMutationError, toastSaveOk } from '../../lib/lms-toast'

type FieldSource = 'environment' | 'database'

export type PlatformSettingsPayload = {
  openRouterApiKey: string
  samlSsoEnabled: boolean
  samlPublicBaseUrl: string
  samlSpEntityId: string
  samlSpX509Pem: string
  samlSpPrivateKeyPem: string
  annotationEnabled: boolean
  feedbackMediaEnabled: boolean
  blindGradingEnabled: boolean
  moderatedGradingEnabled: boolean
  originalityDetectionEnabled: boolean
  originalityStubExternal: boolean
  gradePostingPoliciesEnabled: boolean
  gradebookCsvEnabled: boolean
  resubmissionWorkflowEnabled: boolean
  ltiEnabled: boolean
  oneRosterEnabled: boolean
  scimEnabled: boolean
  sources: {
    openRouterApiKey: FieldSource
    samlSsoEnabled: FieldSource
    samlPublicBaseUrl: FieldSource
    samlSpEntityId: FieldSource
    samlSpX509Pem: FieldSource
    samlSpPrivateKeyPem: FieldSource
    annotationEnabled: FieldSource
    feedbackMediaEnabled: FieldSource
    blindGradingEnabled: FieldSource
    moderatedGradingEnabled: FieldSource
    originalityDetectionEnabled: FieldSource
    originalityStubExternal: FieldSource
    gradePostingPoliciesEnabled: FieldSource
    gradebookCsvEnabled: FieldSource
    resubmissionWorkflowEnabled: FieldSource
    ltiEnabled: FieldSource
    oneRosterEnabled: FieldSource
    scimEnabled: FieldSource
  }
}

function emptyForm(): PlatformSettingsPayload {
  return {
    openRouterApiKey: '',
    samlSsoEnabled: false,
    samlPublicBaseUrl: '',
    samlSpEntityId: '',
    samlSpX509Pem: '',
    samlSpPrivateKeyPem: '',
    annotationEnabled: false,
    feedbackMediaEnabled: false,
    blindGradingEnabled: true,
    moderatedGradingEnabled: false,
    originalityDetectionEnabled: false,
    originalityStubExternal: false,
    gradePostingPoliciesEnabled: true,
    gradebookCsvEnabled: false,
    resubmissionWorkflowEnabled: false,
    ltiEnabled: false,
    oneRosterEnabled: false,
    scimEnabled: false,
    sources: {
      openRouterApiKey: 'environment',
      samlSsoEnabled: 'environment',
      samlPublicBaseUrl: 'environment',
      samlSpEntityId: 'environment',
      samlSpX509Pem: 'environment',
      samlSpPrivateKeyPem: 'environment',
      annotationEnabled: 'environment',
      feedbackMediaEnabled: 'environment',
      blindGradingEnabled: 'environment',
      moderatedGradingEnabled: 'environment',
      originalityDetectionEnabled: 'environment',
      originalityStubExternal: 'environment',
      gradePostingPoliciesEnabled: 'environment',
      gradebookCsvEnabled: 'environment',
      resubmissionWorkflowEnabled: 'environment',
      ltiEnabled: 'environment',
      oneRosterEnabled: 'environment',
      scimEnabled: 'environment',
    },
  }
}

function sourceBadge(src: FieldSource) {
  if (src === 'database') {
    return (
      <span className="ml-2 rounded-md bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-800 dark:bg-indigo-950/80 dark:text-indigo-200">
        Database
      </span>
    )
  }
  return (
    <span className="ml-2 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:bg-neutral-700 dark:text-neutral-300">
      Environment
    </span>
  )
}

export function PlatformSettingsPanel() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<PlatformSettingsPayload>(() => emptyForm())
  const [baseline, setBaseline] = useState<PlatformSettingsPayload>(() => emptyForm())

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await authorizedFetch('/api/v1/settings/platform')
      const raw: unknown = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(readApiErrorMessage(raw))
      }
      const data = raw as PlatformSettingsPayload
      setForm(data)
      setBaseline(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load platform settings.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function update<K extends keyof PlatformSettingsPayload>(key: K, value: PlatformSettingsPayload[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const mask: string[] = []
      const body: Record<string, unknown> = {}

      const maybe = (field: string, before: unknown, after: unknown, apply: () => void) => {
        if (before !== after) {
          mask.push(field)
          apply()
        }
      }

      maybe(
        'openRouterApiKey',
        baseline.openRouterApiKey,
        form.openRouterApiKey,
        () => {
          const v = form.openRouterApiKey.trim()
          if (v && v !== PLATFORM_SECRET_PLACEHOLDER) {
            body.openRouterApiKey = v
          }
        },
      )

      if (
        baseline.sources.openRouterApiKey === 'database' &&
        form.openRouterApiKey.trim() === '' &&
        baseline.openRouterApiKey !== form.openRouterApiKey
      ) {
        mask.push('clearOpenRouterApiKey')
        body.clearOpenRouterApiKey = true
      }

      maybe('samlSsoEnabled', baseline.samlSsoEnabled, form.samlSsoEnabled, () => {
        body.samlSsoEnabled = form.samlSsoEnabled
      })
      maybe('samlPublicBaseUrl', baseline.samlPublicBaseUrl, form.samlPublicBaseUrl, () => {
        body.samlPublicBaseUrl = form.samlPublicBaseUrl.trim()
      })
      maybe('samlSpEntityId', baseline.samlSpEntityId, form.samlSpEntityId, () => {
        body.samlSpEntityId = form.samlSpEntityId.trim()
      })
      maybe('samlSpX509Pem', baseline.samlSpX509Pem, form.samlSpX509Pem, () => {
        const v = form.samlSpX509Pem.trim()
        if (v && v !== PLATFORM_SECRET_PLACEHOLDER) {
          body.samlSpX509Pem = v
        }
      })
      maybe('samlSpPrivateKeyPem', baseline.samlSpPrivateKeyPem, form.samlSpPrivateKeyPem, () => {
        const v = form.samlSpPrivateKeyPem.trim()
        if (v && v !== PLATFORM_SECRET_PLACEHOLDER) {
          body.samlSpPrivateKeyPem = v
        }
      })

      maybe('annotationEnabled', baseline.annotationEnabled, form.annotationEnabled, () => {
        body.annotationEnabled = form.annotationEnabled
      })
      maybe('feedbackMediaEnabled', baseline.feedbackMediaEnabled, form.feedbackMediaEnabled, () => {
        body.feedbackMediaEnabled = form.feedbackMediaEnabled
      })
      maybe('blindGradingEnabled', baseline.blindGradingEnabled, form.blindGradingEnabled, () => {
        body.blindGradingEnabled = form.blindGradingEnabled
      })
      maybe('moderatedGradingEnabled', baseline.moderatedGradingEnabled, form.moderatedGradingEnabled, () => {
        body.moderatedGradingEnabled = form.moderatedGradingEnabled
      })
      maybe(
        'originalityDetectionEnabled',
        baseline.originalityDetectionEnabled,
        form.originalityDetectionEnabled,
        () => {
          body.originalityDetectionEnabled = form.originalityDetectionEnabled
        },
      )
      maybe('originalityStubExternal', baseline.originalityStubExternal, form.originalityStubExternal, () => {
        body.originalityStubExternal = form.originalityStubExternal
      })
      maybe(
        'gradePostingPoliciesEnabled',
        baseline.gradePostingPoliciesEnabled,
        form.gradePostingPoliciesEnabled,
        () => {
          body.gradePostingPoliciesEnabled = form.gradePostingPoliciesEnabled
        },
      )
      maybe('gradebookCsvEnabled', baseline.gradebookCsvEnabled, form.gradebookCsvEnabled, () => {
        body.gradebookCsvEnabled = form.gradebookCsvEnabled
      })
      maybe(
        'resubmissionWorkflowEnabled',
        baseline.resubmissionWorkflowEnabled,
        form.resubmissionWorkflowEnabled,
        () => {
          body.resubmissionWorkflowEnabled = form.resubmissionWorkflowEnabled
        },
      )
      maybe('ltiEnabled', baseline.ltiEnabled, form.ltiEnabled, () => {
        body.ltiEnabled = form.ltiEnabled
      })
      maybe('oneRosterEnabled', baseline.oneRosterEnabled, form.oneRosterEnabled, () => {
        body.oneRosterEnabled = form.oneRosterEnabled
      })
      maybe('scimEnabled', baseline.scimEnabled, form.scimEnabled, () => {
        body.scimEnabled = form.scimEnabled
      })

      if (mask.length === 0) {
        toastSaveOk('No changes to save.')
        setSaving(false)
        return
      }

      body.updateMask = mask

      const res = await authorizedFetch('/api/v1/settings/platform', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const raw: unknown = await res.json().catch(() => ({}))
      if (!res.ok) {
        toastMutationError(readApiErrorMessage(raw))
        return
      }
      const data = raw as PlatformSettingsPayload
      setForm(data)
      setBaseline(data)
      toastSaveOk('Platform settings saved.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  const chk =
    'rounded border border-slate-200 bg-white text-indigo-600 focus:ring-indigo-500 dark:border-neutral-600 dark:bg-neutral-800'

  if (loading) {
    return <p className="mt-4 text-sm text-slate-500 dark:text-neutral-400">Loading platform settings…</p>
  }

  return (
    <div>
      <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
        Values stored here override the server process environment when set. Requires{' '}
        <code className="rounded bg-slate-100 px-1 font-mono text-xs dark:bg-neutral-800">global:app:rbac:manage</code>.
        Secrets are never returned in plain text after save.
      </p>

      {error && (
        <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-200">
          {error}
        </p>
      )}

      <form className="mt-8 space-y-10" onSubmit={onSubmit}>
        <section>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-neutral-100">AI — OpenRouter</h3>
          <p className="mt-1 text-xs text-slate-500 dark:text-neutral-400">
            Used for AI generation (models list, notebook RAG, etc.). Leave unchanged to keep the current key.
          </p>
          <label className="mt-4 block text-sm font-medium text-slate-700 dark:text-neutral-200">
            API key {sourceBadge(form.sources.openRouterApiKey)}
          </label>
          <input
            type="password"
            autoComplete="off"
            value={form.openRouterApiKey}
            onChange={(e) => update('openRouterApiKey', e.target.value)}
            placeholder={PLATFORM_SECRET_PLACEHOLDER}
            className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-mono text-sm text-slate-900 outline-none ring-indigo-500/20 focus:border-indigo-400 focus:ring-2 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
          />
        </section>

        <section>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-neutral-100">SAML service provider</h3>
          <p className="mt-1 text-xs text-slate-500 dark:text-neutral-400">
            Browser SSO endpoints use these SP settings (IdP metadata remains under Admin SAML).
          </p>
          <div className="mt-4 space-y-4">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-neutral-200">
              <input
                type="checkbox"
                checked={form.samlSsoEnabled}
                onChange={(e) => update('samlSsoEnabled', e.target.checked)}
                className={chk}
              />
              Enable SAML SSO {sourceBadge(form.sources.samlSsoEnabled)}
            </label>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-neutral-200">
                Public base URL {sourceBadge(form.sources.samlPublicBaseUrl)}
              </label>
              <input
                type="url"
                value={form.samlPublicBaseUrl}
                onChange={(e) => update('samlPublicBaseUrl', e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-neutral-200">
                SP entity ID {sourceBadge(form.sources.samlSpEntityId)}
              </label>
              <input
                type="text"
                value={form.samlSpEntityId}
                onChange={(e) => update('samlSpEntityId', e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-neutral-200">
                SP X.509 certificate (PEM) {sourceBadge(form.sources.samlSpX509Pem)}
              </label>
              <textarea
                rows={5}
                spellCheck={false}
                value={form.samlSpX509Pem}
                onChange={(e) => update('samlSpX509Pem', e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-mono text-xs dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-neutral-200">
                SP private key (PEM) {sourceBadge(form.sources.samlSpPrivateKeyPem)}
              </label>
              <textarea
                rows={4}
                spellCheck={false}
                placeholder={PLATFORM_SECRET_PLACEHOLDER}
                value={form.samlSpPrivateKeyPem}
                onChange={(e) => update('samlSpPrivateKeyPem', e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-mono text-xs dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
              />
            </div>
          </div>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-neutral-100">Platform feature flags</h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <FlagRow
              label="Annotations"
              src={form.sources.annotationEnabled}
              checked={form.annotationEnabled}
              onChange={(v) => update('annotationEnabled', v)}
            />
            <FlagRow
              label="Feedback media"
              src={form.sources.feedbackMediaEnabled}
              checked={form.feedbackMediaEnabled}
              onChange={(v) => update('feedbackMediaEnabled', v)}
            />
            <FlagRow
              label="Blind grading"
              src={form.sources.blindGradingEnabled}
              checked={form.blindGradingEnabled}
              onChange={(v) => update('blindGradingEnabled', v)}
            />
            <FlagRow
              label="Moderated grading"
              src={form.sources.moderatedGradingEnabled}
              checked={form.moderatedGradingEnabled}
              onChange={(v) => update('moderatedGradingEnabled', v)}
            />
            <FlagRow
              label="Originality detection"
              src={form.sources.originalityDetectionEnabled}
              checked={form.originalityDetectionEnabled}
              onChange={(v) => update('originalityDetectionEnabled', v)}
            />
            <FlagRow
              label="Originality stub external"
              src={form.sources.originalityStubExternal}
              checked={form.originalityStubExternal}
              onChange={(v) => update('originalityStubExternal', v)}
            />
            <FlagRow
              label="Grade posting policies"
              src={form.sources.gradePostingPoliciesEnabled}
              checked={form.gradePostingPoliciesEnabled}
              onChange={(v) => update('gradePostingPoliciesEnabled', v)}
            />
            <FlagRow
              label="Gradebook CSV export"
              src={form.sources.gradebookCsvEnabled}
              checked={form.gradebookCsvEnabled}
              onChange={(v) => update('gradebookCsvEnabled', v)}
            />
            <FlagRow
              label="Resubmission workflow"
              src={form.sources.resubmissionWorkflowEnabled}
              checked={form.resubmissionWorkflowEnabled}
              onChange={(v) => update('resubmissionWorkflowEnabled', v)}
            />
            <FlagRow
              label="LTI"
              src={form.sources.ltiEnabled}
              checked={form.ltiEnabled}
              onChange={(v) => update('ltiEnabled', v)}
            />
            <FlagRow
              label="OneRoster API"
              src={form.sources.oneRosterEnabled}
              checked={form.oneRosterEnabled}
              onChange={(v) => update('oneRosterEnabled', v)}
            />
            <FlagRow
              label="SCIM 2.0 provisioning"
              src={form.sources.scimEnabled}
              checked={form.scimEnabled}
              onChange={(v) => update('scimEnabled', v)}
            />
          </div>
        </section>

        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-950 dark:hover:bg-white"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          <button
            type="button"
            onClick={() => void load()}
            disabled={saving || loading}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
          >
            Reload
          </button>
        </div>
      </form>
    </div>
  )
}

function FlagRow(props: {
  label: string
  src: FieldSource
  checked: boolean
  onChange: (v: boolean) => void
}) {
  const chk =
    'rounded border border-slate-200 bg-white text-indigo-600 focus:ring-indigo-500 dark:border-neutral-600 dark:bg-neutral-800'
  return (
    <label className="flex items-start gap-2 rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2.5 dark:border-neutral-700 dark:bg-neutral-800/40">
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} className={chk} />
      <span className="text-sm text-slate-800 dark:text-neutral-100">
        {props.label}
        {sourceBadge(props.src)}
      </span>
    </label>
  )
}
