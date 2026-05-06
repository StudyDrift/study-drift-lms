import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { authorizedFetch, apiUrl } from '../../lib/api'
import { readApiErrorMessage } from '../../lib/errors'
import { toastMutationError, toastSaveOk } from '../../lib/lms-toast'

type ScimToken = {
  id: string
  institutionId: string
  label: string
  createdAt: string
  revokedAt?: string | null
}

type ScimEvent = {
  id: string
  operation: string
  scimResource: string
  userEmail?: string | null
  createdAt: string
}

export function ScimSettingsPanel() {
  const [institutionId, setInstitutionId] = useState('')
  const [label, setLabel] = useState('')
  const [tokens, setTokens] = useState<ScimToken[]>([])
  const [events, setEvents] = useState<ScimEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [newToken, setNewToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const instOk = useMemo(() => {
    const s = institutionId.trim()
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)
  }, [institutionId])

  const scimBase = apiUrl('/scim/v2')

  const refresh = useCallback(async () => {
    if (!instOk) return
    setLoading(true)
    setError(null)
    try {
      const q = encodeURIComponent(institutionId.trim())
      const [tr, er] = await Promise.all([
        authorizedFetch(`/api/v1/admin/provisioning/scim/tokens?institutionId=${q}`),
        authorizedFetch(`/api/v1/admin/provisioning/scim/events?institutionId=${q}`),
      ])
      const trRaw: unknown = await tr.json().catch(() => ({}))
      const erRaw: unknown = await er.json().catch(() => ({}))
      if (!tr.ok) throw new Error(readApiErrorMessage(trRaw))
      if (!er.ok) throw new Error(readApiErrorMessage(erRaw))
      const tj = trRaw as { tokens?: ScimToken[] }
      const ej = erRaw as { events?: ScimEvent[] }
      setTokens(tj.tokens ?? [])
      setEvents(ej.events ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load SCIM data.')
    } finally {
      setLoading(false)
    }
  }, [instOk, institutionId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function onGenerate(e: FormEvent) {
    e.preventDefault()
    if (!instOk) return
    setError(null)
    try {
      const res = await authorizedFetch('/api/v1/admin/provisioning/scim/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ institutionId: institutionId.trim(), label: label.trim() }),
      })
      const raw: unknown = await res.json().catch(() => ({}))
      if (!res.ok) {
        toastMutationError(readApiErrorMessage(raw))
        return
      }
      const body = raw as { token?: string }
      if (body.token) setNewToken(body.token)
      setLabel('')
      toastSaveOk('SCIM bearer token created.')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed.')
    }
  }

  async function revoke(id: string) {
    setError(null)
    try {
      const res = await authorizedFetch(`/api/v1/admin/provisioning/scim/tokens/${id}`, { method: 'DELETE' })
      const raw: unknown = await res.json().catch(() => ({}))
      if (!res.ok) {
        toastMutationError(readApiErrorMessage(raw))
        return
      }
      toastSaveOk('Token revoked.')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Revoke failed.')
    }
  }

  return (
    <div className="mt-6 space-y-8">
      <p className="text-sm text-slate-600 dark:text-neutral-400">
        Configure IdP provisioning with RFC 7644. Use the same institution UUID as OneRoster / SAML mappings where applicable.
      </p>
      {error && (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-200">
          {error}
        </p>
      )}
      <section>
        <h3 className="text-sm font-semibold text-slate-900 dark:text-neutral-100">SCIM endpoint</h3>
        <p className="mt-1 text-xs text-slate-500 dark:text-neutral-400">
          Base URL for Okta / Entra (configure path suffix <code className="font-mono">/Users</code> etc.).
        </p>
        <input
          readOnly
          value={scimBase}
          className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-800 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
          aria-label="SCIM API base URL"
        />
      </section>

      <section>
        <h3 className="text-sm font-semibold text-slate-900 dark:text-neutral-100">Institution</h3>
        <label className="mt-2 block text-sm font-medium text-slate-700 dark:text-neutral-200">Institution ID (UUID)</label>
        <input
          value={institutionId}
          onChange={(e) => setInstitutionId(e.target.value)}
          placeholder="00000000-0000-0000-0000-000000000000"
          className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm outline-none ring-indigo-500/20 focus:border-indigo-400 focus:ring-2 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
        />
      </section>

      <section>
        <h3 className="text-sm font-semibold text-slate-900 dark:text-neutral-100">Bearer token</h3>
        <form onSubmit={onGenerate} className="mt-3 flex flex-wrap items-end gap-3">
          <div className="min-w-[200px] flex-1">
            <label className="block text-xs font-medium text-slate-600 dark:text-neutral-400">Label (optional)</label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </div>
          <button
            type="submit"
            disabled={!instOk}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-950 dark:hover:bg-white"
          >
            Generate token
          </button>
        </form>
        {newToken && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/40 dark:bg-amber-950/30">
            <p className="text-xs font-medium text-amber-900 dark:text-amber-100">Copy now — shown once:</p>
            <input
              readOnly
              value={newToken}
              aria-label="SCIM bearer token (shown once)"
              className="mt-2 w-full rounded-lg border border-amber-200 bg-white px-2 py-1.5 font-mono text-xs dark:border-amber-900/50 dark:bg-neutral-900 dark:text-amber-50"
              onFocus={(e) => e.currentTarget.select()}
            />
            <button
              type="button"
              className="mt-2 text-xs font-semibold text-amber-900 underline dark:text-amber-200"
              onClick={() => void navigator.clipboard.writeText(newToken)}
            >
              Copy to clipboard
            </button>
          </div>
        )}
      </section>

      <section>
        <h3 className="text-sm font-semibold text-slate-900 dark:text-neutral-100">Tokens</h3>
        {loading && <p className="mt-2 text-sm text-slate-500">Loading…</p>}
        {!loading && !instOk && <p className="mt-2 text-sm text-slate-500">Enter a valid institution UUID.</p>}
        {!loading && instOk && tokens.length === 0 && (
          <p className="mt-2 text-sm text-slate-500">No tokens yet for this institution.</p>
        )}
        {instOk && tokens.length > 0 && (
          <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 dark:border-neutral-700">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-600 dark:bg-neutral-800 dark:text-neutral-400">
                <tr>
                  <th className="px-3 py-2">Label</th>
                  <th className="px-3 py-2">Created</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {tokens.map((t) => (
                  <tr key={t.id} className="border-t border-slate-100 dark:border-neutral-700">
                    <td className="px-3 py-2">{t.label || '—'}</td>
                    <td className="px-3 py-2 font-mono text-xs">{new Date(t.createdAt).toLocaleString()}</td>
                    <td className="px-3 py-2">{t.revokedAt ? 'Revoked' : 'Active'}</td>
                    <td className="px-3 py-2 text-right">
                      {!t.revokedAt && (
                        <button
                          type="button"
                          className="text-rose-600 text-xs font-semibold hover:underline dark:text-rose-400"
                          onClick={() => void revoke(t.id)}
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h3 className="text-sm font-semibold text-slate-900 dark:text-neutral-100">Provisioning events</h3>
        {instOk && events.length === 0 && !loading && (
          <p className="mt-2 text-sm text-slate-500">No events logged yet.</p>
        )}
        {instOk && events.length > 0 && (
          <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 dark:border-neutral-700">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-600 dark:bg-neutral-800 dark:text-neutral-400">
                <tr>
                  <th className="px-3 py-2">Time</th>
                  <th className="px-3 py-2">Operation</th>
                  <th className="px-3 py-2">Resource</th>
                  <th className="px-3 py-2">User</th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev) => (
                  <tr key={ev.id} className="border-t border-slate-100 dark:border-neutral-700">
                    <td className="px-3 py-2 font-mono text-xs">{new Date(ev.createdAt).toLocaleString()}</td>
                    <td className="px-3 py-2">{ev.operation}</td>
                    <td className="px-3 py-2">{ev.scimResource}</td>
                    <td className="px-3 py-2">{ev.userEmail ?? '—'}</td>
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
