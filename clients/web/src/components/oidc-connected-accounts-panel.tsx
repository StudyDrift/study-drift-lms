import { useCallback, useEffect, useState } from 'react'
import { apiUrl, authorizedFetch } from '../lib/api'
import { readApiErrorMessage } from '../lib/errors'

type Identity = { id: string; provider: string; email: string | null }

type OidcStatus = {
  enabled: boolean
  google?: boolean
  microsoft?: boolean
  apple?: boolean
  custom?: { id: string; displayName: string }[]
}

/** Account settings: list linked OIDC identities and allow disconnect / connect-more. */
export function OidcConnectedAccountsPanel() {
  const [status, setStatus] = useState<OidcStatus | null>(null)
  const [ids, setIds] = useState<Identity[] | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    try {
      const [st, list] = await Promise.all([
        fetch(apiUrl('/api/v1/auth/oidc/status')).then((r) => r.json()),
        authorizedFetch('/api/v1/me/oidc-identities').then((r) => r.json()),
      ])
      setStatus(st as OidcStatus)
      const raw = list as { identities?: Identity[] }
      setIds(raw.identities ?? [])
    } catch {
      setStatus({ enabled: false })
      setIds([])
    }
  }, [])

  const reload = useCallback(async () => {
    setMsg(null)
    await loadData()
  }, [loadData])

  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch for OIDC panel */
    void loadData()
  }, [loadData])

  async function connect(provider: string, configId?: string) {
    setMsg(null)
    try {
      const res = await authorizedFetch('/api/v1/auth/oidc/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          ...(configId ? { configId } : {}),
        }),
      })
      const raw: unknown = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMsg(readApiErrorMessage(raw))
        return
      }
      const o = raw as { loginUrl?: string }
      if (o.loginUrl) {
        window.location.href = o.loginUrl
      }
    } catch {
      setMsg('Could not start linking.')
    }
  }

  async function disconnect(id: string) {
    setMsg(null)
    try {
      const res = await authorizedFetch(`/api/v1/me/oidc-identities/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const raw: unknown = await res.json().catch(() => ({}))
        setMsg(readApiErrorMessage(raw))
        return
      }
      await reload()
    } catch {
      setMsg('Could not disconnect.')
    }
  }

  if (!status?.enabled) return null

  return (
    <div className="mt-10 border-t border-slate-200 pt-8 dark:border-neutral-600">
      <h3 className="text-sm font-medium text-slate-700 dark:text-neutral-200">Connected accounts</h3>
      <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
        Sign-in methods linked to this Lextures account (OpenID Connect).
      </p>
      {msg && (
        <p className="mt-2 text-sm text-rose-600" role="status">
          {msg}
        </p>
      )}
      {ids && ids.length > 0 && (
        <ul className="mt-4 space-y-2">
          {ids.map((i) => (
            <li
              key={i.id}
              className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800/50"
            >
              <span>
                <span className="font-medium capitalize text-slate-800 dark:text-neutral-100">{i.provider}</span>
                {i.email && <span className="text-slate-500 dark:text-neutral-400"> — {i.email}</span>}
              </span>
              <button
                type="button"
                className="text-sm font-medium text-rose-600 hover:text-rose-500"
                onClick={() => void disconnect(i.id)}
              >
                Disconnect
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {status.google && (
          <button
            type="button"
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
            onClick={() => void connect('google')}
          >
            Link Google
          </button>
        )}
        {status.microsoft && (
          <button
            type="button"
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
            onClick={() => void connect('microsoft')}
          >
            Link Microsoft
          </button>
        )}
        {status.apple && (
          <button
            type="button"
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
            onClick={() => void connect('apple')}
          >
            Link Apple
          </button>
        )}
        {status.custom?.map((c) => (
          <button
            key={c.id}
            type="button"
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
            onClick={() => void connect('custom', c.id)}
          >
            Link {c.displayName}
          </button>
        ))}
      </div>
    </div>
  )
}
