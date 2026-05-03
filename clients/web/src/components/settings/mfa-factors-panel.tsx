import { startRegistration } from '@simplewebauthn/browser'
import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { authorizedFetch } from '../../lib/api'
import { readApiErrorMessage } from '../../lib/errors'
import { toastMutationError, toastSaveOk } from '../../lib/lms-toast'

type Factor = {
  id: string
  kind: 'totp' | 'webauthn'
  label?: string
  createdAt: string
}

export function MfaFactorsPanel() {
  const [loading, setLoading] = useState(true)
  const [factors, setFactors] = useState<Factor[]>([])
  const [error, setError] = useState<string | null>(null)
  const [totpCredId, setTotpCredId] = useState<string | null>(null)
  const [totpQrUrl, setTotpQrUrl] = useState<string | null>(null)
  const [totpCode, setTotpCode] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await authorizedFetch('/api/v1/me/mfa')
      const raw: unknown = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(readApiErrorMessage(raw))
        return
      }
      const data = raw as { factors?: Factor[] }
      setFactors(data.factors ?? [])
    } catch {
      setError('Could not load MFA settings.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function startTotp() {
    setBusy(true)
    setError(null)
    try {
      const res = await authorizedFetch('/api/v1/auth/mfa/totp/enrol', { method: 'POST' })
      const raw: unknown = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(readApiErrorMessage(raw))
        return
      }
      const data = raw as { credential_id?: string; otpauth_uri?: string }
      if (data.credential_id) setTotpCredId(data.credential_id)
      if (data.otpauth_uri) {
        setTotpQrUrl(
          `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(data.otpauth_uri)}`,
        )
      }
    } catch {
      setError('Could not start authenticator enrolment.')
    } finally {
      setBusy(false)
    }
  }

  async function confirmTotp(e: FormEvent) {
    e.preventDefault()
    if (!totpCredId || totpCode.length !== 6) return
    setBusy(true)
    setError(null)
    try {
      const res = await authorizedFetch('/api/v1/auth/mfa/totp/verify-enrol', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential_id: totpCredId, code: totpCode }),
      })
      const raw: unknown = await res.json().catch(() => ({}))
      if (!res.ok) {
        toastMutationError(readApiErrorMessage(raw))
        return
      }
      const data = raw as { backup_codes?: string[] }
      if (data.backup_codes?.length) {
        const text = data.backup_codes.join('\n')
        try {
          await navigator.clipboard.writeText(text)
          toastSaveOk('Backup codes copied to clipboard. Store them safely; each works once.')
        } catch {
          toastSaveOk(`Backup codes (copy manually): ${data.backup_codes.join(', ')}`)
        }
      }
      setTotpCredId(null)
      setTotpQrUrl(null)
      setTotpCode('')
      toastSaveOk('Authenticator added.')
      await load()
    } catch {
      toastMutationError('Could not verify authenticator.')
    } finally {
      setBusy(false)
    }
  }

  async function addPasskey() {
    const name = globalThis.prompt('Name this passkey (optional)', 'Passkey') ?? ''
    setBusy(true)
    setError(null)
    try {
      const res = await authorizedFetch('/api/v1/auth/mfa/webauthn/register/begin', { method: 'POST' })
      const raw: unknown = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(readApiErrorMessage(raw))
        return
      }
      const data = raw as { session_id?: string; options?: unknown }
      if (!data.session_id || data.options == null) {
        setError('Passkeys are not available.')
        return
      }
      const credential = await startRegistration({
        optionsJSON: data.options as Parameters<typeof startRegistration>[0]['optionsJSON'],
      })
      const res2 = await authorizedFetch('/api/v1/auth/mfa/webauthn/register/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: data.session_id,
          credential,
          display_name: name.trim(),
        }),
      })
      const raw2: unknown = await res2.json().catch(() => ({}))
      if (!res2.ok) {
        toastMutationError(readApiErrorMessage(raw2))
        return
      }
      const out = raw2 as { backup_codes?: string[] }
      if (out.backup_codes?.length) {
        const text = out.backup_codes.join('\n')
        try {
          await navigator.clipboard.writeText(text)
          toastSaveOk('Backup codes copied to clipboard. Store them safely; each works once.')
        } catch {
          toastSaveOk(`Backup codes (copy manually): ${out.backup_codes.join(', ')}`)
        }
      }
      toastSaveOk('Passkey added.')
      await load()
    } catch {
      toastMutationError('Passkey enrolment failed or was cancelled.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    if (!globalThis.confirm('Remove this sign-in method?')) return
    setBusy(true)
    try {
      const res = await authorizedFetch(`/api/v1/me/mfa/${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!res.ok) {
        const raw: unknown = await res.json().catch(() => ({}))
        toastMutationError(readApiErrorMessage(raw))
        return
      }
      toastSaveOk('Removed.')
      await load()
    } catch {
      toastMutationError('Remove failed.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <p className="mt-6 text-sm text-slate-500">Loading security settings…</p>
  }

  return (
    <div className="mt-10 border-t border-slate-200 pt-8 dark:border-neutral-700">
      <h3 className="text-sm font-semibold text-slate-900 dark:text-neutral-100">Two-factor authentication</h3>
      <p className="mt-1 text-xs text-slate-500 dark:text-neutral-400">
        Add an authenticator app or a passkey. Backup codes are shown once when you first enrol.
      </p>
      {error && (
        <p className="mt-3 text-sm text-rose-600" role="status">
          {error}
        </p>
      )}
      <ul className="mt-4 space-y-2">
        {factors.map((f) => (
          <li
            key={f.id}
            className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800/40"
          >
            <span className="text-slate-800 dark:text-neutral-100">
              <span className="font-medium">{f.kind === 'totp' ? 'Authenticator app' : 'Passkey'}</span>
              {f.label ? <span className="text-slate-500"> — {f.label}</span> : null}
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => void remove(f.id)}
              className="text-sm font-medium text-rose-600 hover:text-rose-500 disabled:opacity-50"
            >
              Remove
            </button>
          </li>
        ))}
        {factors.length === 0 && <li className="text-sm text-slate-500">No second factors yet.</li>}
      </ul>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !!totpQrUrl}
          onClick={() => void startTotp()}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700"
        >
          Add authenticator (QR)
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void addPasskey()}
          className="rounded-xl bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50"
        >
          Add passkey
        </button>
      </div>
      {totpQrUrl && (
        <form className="mt-6 space-y-3" onSubmit={confirmTotp}>
          <p className="text-sm text-slate-600">Scan the QR code, then enter the 6-digit code to confirm.</p>
          <img src={totpQrUrl} alt="Authenticator QR" className="h-44 w-44 rounded-lg border border-slate-200" />
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-label="One-time code (6 digits)"
            value={totpCode}
            onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            className="w-full max-w-xs rounded-xl border border-slate-200 px-3 py-2 font-mono text-lg tracking-widest dark:border-neutral-600 dark:bg-neutral-900"
            placeholder="000000"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || totpCode.length !== 6}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Confirm
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setTotpCredId(null)
                setTotpQrUrl(null)
                setTotpCode('')
              }}
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm dark:border-neutral-600"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
