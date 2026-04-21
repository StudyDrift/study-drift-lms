import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { authorizedFetch } from '../../lib/api'
import { readApiErrorMessage } from '../../lib/errors'

type ParentPlatform = {
  id: string
  name: string
  clientId: string
  platformIss: string
  platformJwksUrl: string
  platformAuthUrl: string
  platformTokenUrl: string
  toolRedirectUris: string[]
  deploymentIds: string[]
  active: boolean
}

type ExternalTool = {
  id: string
  name: string
  clientId: string
  toolIssuer: string
  toolJwksUrl: string
  toolOidcAuthUrl: string
  toolTokenUrl: string | null
  active: boolean
}

type RegistrationsResponse = {
  parentPlatforms: ParentPlatform[]
  externalTools: ExternalTool[]
}

export function LtiToolsSettingsPanel() {
  const [data, setData] = useState<RegistrationsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const [extName, setExtName] = useState('')
  const [extClientId, setExtClientId] = useState('')
  const [extIssuer, setExtIssuer] = useState('')
  const [extJwks, setExtJwks] = useState('')
  const [extAuth, setExtAuth] = useState('')
  const [extToken, setExtToken] = useState('')
  const [extSaving, setExtSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await authorizedFetch('/api/v1/admin/lti/registrations')
      const raw: unknown = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(readApiErrorMessage(raw))
      setData(raw as RegistrationsResponse)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load LTI registrations.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function onCreateExternal(e: FormEvent) {
    e.preventDefault()
    setMessage(null)
    setExtSaving(true)
    try {
      const res = await authorizedFetch('/api/v1/admin/lti/external-tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: extName.trim(),
          clientId: extClientId.trim(),
          toolIssuer: extIssuer.trim(),
          toolJwksUrl: extJwks.trim(),
          toolOidcAuthUrl: extAuth.trim(),
          toolTokenUrl: extToken.trim() || null,
        }),
      })
      const raw: unknown = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(readApiErrorMessage(raw))
      setExtName('')
      setExtClientId('')
      setExtIssuer('')
      setExtJwks('')
      setExtAuth('')
      setExtToken('')
      setMessage('External tool saved.')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.')
    } finally {
      setExtSaving(false)
    }
  }

  return (
    <div>
      <h2 className="text-base font-semibold text-slate-900 dark:text-neutral-100">LTI tools</h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
        Register external LTI 1.3 tools (for embedding in courses) and parent LMS platforms (for launching
        Lextures as a tool). Set <code className="font-mono text-xs">LTI_ENABLED=1</code> and{' '}
        <code className="font-mono text-xs">LTI_RSA_PRIVATE_KEY_PEM</code> on the API server for LTI endpoints to
        respond.
      </p>

      {loading ? <p className="mt-6 text-sm text-slate-500 dark:text-neutral-400">Loading…</p> : null}
      {error ? (
        <p className="mt-4 text-sm text-rose-600 dark:text-rose-400" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="mt-4 text-sm text-emerald-700 dark:text-emerald-400" role="status">
          {message}
        </p>
      ) : null}

      {data ? (
        <div className="mt-8 grid gap-10 lg:grid-cols-2">
          <section>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-neutral-100">Parent LMS (Lextures as tool)</h3>
            <ul className="mt-3 space-y-2 text-sm text-slate-700 dark:text-neutral-200">
              {data.parentPlatforms.length === 0 ? (
                <li className="text-slate-500 dark:text-neutral-400">None yet.</li>
              ) : (
                data.parentPlatforms.map((p) => (
                  <li key={p.id} className="rounded-lg border border-slate-200 px-3 py-2 dark:border-neutral-600">
                    <span className="font-medium">{p.name}</span>{' '}
                    <span className="text-slate-500 dark:text-neutral-400">({p.platformIss})</span>
                  </li>
                ))
              )}
            </ul>
            <p className="mt-3 text-xs text-slate-500 dark:text-neutral-400">
              Create parent registrations via the API or a future form; fields match the IMS LTI platform
              configuration (issuer, JWKS, OAuth URLs, redirect URIs).
            </p>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-neutral-100">External tools (Lextures as platform)</h3>
            <ul className="mt-3 space-y-2 text-sm text-slate-700 dark:text-neutral-200">
              {data.externalTools.map((t) => (
                <li key={t.id} className="rounded-lg border border-slate-200 px-3 py-2 dark:border-neutral-600">
                  <span className="font-medium">{t.name}</span>
                  {!t.active ? (
                    <span className="ml-2 text-xs uppercase text-amber-700 dark:text-amber-300">inactive</span>
                  ) : null}
                </li>
              ))}
            </ul>

            <form onSubmit={onCreateExternal} className="mt-6 space-y-3 rounded-xl border border-slate-200 p-4 dark:border-neutral-600">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-neutral-400">
                Register external tool
              </p>
              <label className="block text-xs text-slate-600 dark:text-neutral-300">
                Name
                <input
                  value={extName}
                  onChange={(e) => setExtName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm dark:border-neutral-600 dark:bg-neutral-900"
                  required
                />
              </label>
              <label className="block text-xs text-slate-600 dark:text-neutral-300">
                Client id (at the tool)
                <input
                  value={extClientId}
                  onChange={(e) => setExtClientId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm dark:border-neutral-600 dark:bg-neutral-900"
                  required
                />
              </label>
              <label className="block text-xs text-slate-600 dark:text-neutral-300">
                Tool issuer (iss)
                <input
                  value={extIssuer}
                  onChange={(e) => setExtIssuer(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm dark:border-neutral-600 dark:bg-neutral-900"
                  required
                />
              </label>
              <label className="block text-xs text-slate-600 dark:text-neutral-300">
                JWKS URL
                <input
                  value={extJwks}
                  onChange={(e) => setExtJwks(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm dark:border-neutral-600 dark:bg-neutral-900"
                  required
                />
              </label>
              <label className="block text-xs text-slate-600 dark:text-neutral-300">
                OIDC login initiation URL
                <input
                  value={extAuth}
                  onChange={(e) => setExtAuth(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm dark:border-neutral-600 dark:bg-neutral-900"
                  required
                />
              </label>
              <label className="block text-xs text-slate-600 dark:text-neutral-300">
                Token URL (optional)
                <input
                  value={extToken}
                  onChange={(e) => setExtToken(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm dark:border-neutral-600 dark:bg-neutral-900"
                />
              </label>
              <button
                type="submit"
                disabled={extSaving}
                className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 dark:bg-indigo-500"
              >
                {extSaving ? 'Saving…' : 'Add tool'}
              </button>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  )
}
