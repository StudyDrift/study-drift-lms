import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import { type FormEvent, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { BrandLogo } from '../components/brand-logo'
import { applyAuthTokenResponse } from '../lib/session-tokens'
import { apiUrl } from '../lib/api'
import { readApiErrorMessage } from '../lib/errors'
import { applyUiTheme, parseUiTheme } from '../lib/ui-theme'
import { markPostLoginShortcutTip } from '../lib/post-login-shortcut-tip'
import { clearMfaFlow, getMfaFlow, type MfaFlowMode } from '../lib/mfa-flow-storage'

type LocationState = { from?: string }

export default function MfaLogin() {
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as LocationState | undefined
  let from = state?.from ?? '/'
  if (
    from === '/login' ||
    from === '/signup' ||
    from === '/forgot-password' ||
    from === '/reset-password' ||
    from.startsWith('/login/mfa') ||
    from.startsWith('/login/magic-link')
  ) {
    from = '/'
  }

  const [flow] = useState<{ token: string; mode: MfaFlowMode } | null>(() => getMfaFlow())
  const [totpCredId, setTotpCredId] = useState<string | null>(null)
  const [totpQrUrl, setTotpQrUrl] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [backup, setBackup] = useState('')
  const [showBackup, setShowBackup] = useState(false)
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [webauthnBusy, setWebauthnBusy] = useState(false)

  if (!flow) {
    return <Navigate to="/login" replace />
  }

  const mfaFlow = flow

  const authHeaders = { Authorization: `Bearer ${mfaFlow.token}` }

  async function finishWithAccessToken(
    tokens: { access_token?: string; refresh_token?: string; expires_in?: number },
    uiTheme?: string | null,
  ) {
    clearMfaFlow()
    setTotpCredId(null)
    setTotpQrUrl(null)
    applyAuthTokenResponse(tokens)
    applyUiTheme(parseUiTheme(uiTheme))
    markPostLoginShortcutTip()
    navigate(from, { replace: true })
  }

  async function completeSetup() {
    setStatus('loading')
    setMessage(null)
    try {
      const res = await fetch(apiUrl('/api/v1/auth/mfa/setup/complete'), {
        method: 'POST',
        headers: { ...authHeaders },
      })
      const raw: unknown = await res.json().catch(() => ({}))
      if (!res.ok) {
        setStatus('error')
        setMessage(readApiErrorMessage(raw))
        return
      }
      const data = raw as {
        access_token?: string
        refresh_token?: string
        expires_in?: number
        user?: { uiTheme?: string | null }
      }
      await finishWithAccessToken(data, data.user?.uiTheme)
    } catch {
      setStatus('error')
      setMessage('Could not reach the server.')
    }
  }

  async function onTotpSubmit(e: FormEvent) {
    e.preventDefault()
    setStatus('loading')
    setMessage(null)
    const path =
      mfaFlow.mode === 'setup'
        ? '/api/v1/auth/mfa/totp/verify-enrol'
        : '/api/v1/auth/mfa/totp/challenge'
    const body =
      mfaFlow.mode === 'setup'
        ? JSON.stringify({ credential_id: totpCredId ?? '', code })
        : JSON.stringify({ code })
    try {
      const res = await fetch(apiUrl(path), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body,
      })
      const raw: unknown = await res.json().catch(() => ({}))
      if (!res.ok) {
        setStatus('error')
        setMessage(readApiErrorMessage(raw))
        return
      }
      if (mfaFlow.mode === 'setup') {
        const data = raw as { backup_codes?: string[] }
        if (data.backup_codes?.length) {
          sessionStorage.setItem('mfa_backup_codes_display', JSON.stringify(data.backup_codes))
        }
        setTotpCredId(null)
        setTotpQrUrl(null)
        await completeSetup()
        return
      }
      const data = raw as {
        access_token?: string
        refresh_token?: string
        expires_in?: number
        user?: { uiTheme?: string | null }
      }
      await finishWithAccessToken(data, data.user?.uiTheme)
    } catch {
      setStatus('error')
      setMessage('Could not reach the server.')
    }
  }

  async function onBackupSubmit(e: FormEvent) {
    e.preventDefault()
    if (mfaFlow.mode !== 'challenge') return
    setStatus('loading')
    setMessage(null)
    try {
      const res = await fetch(apiUrl('/api/v1/auth/mfa/backup/challenge'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ code: backup }),
      })
      const raw: unknown = await res.json().catch(() => ({}))
      if (!res.ok) {
        setStatus('error')
        setMessage(readApiErrorMessage(raw))
        return
      }
      const data = raw as {
        access_token?: string
        refresh_token?: string
        expires_in?: number
        user?: { uiTheme?: string | null }
      }
      await finishWithAccessToken(data, data.user?.uiTheme)
    } catch {
      setStatus('error')
      setMessage('Could not reach the server.')
    }
  }

  async function startTotpEnrol() {
    setStatus('loading')
    setMessage(null)
    try {
      const res = await fetch(apiUrl('/api/v1/auth/mfa/totp/enrol'), {
        method: 'POST',
        headers: { ...authHeaders },
      })
      const raw: unknown = await res.json().catch(() => ({}))
      if (!res.ok) {
        setStatus('error')
        setMessage(readApiErrorMessage(raw))
        return
      }
      const data = raw as { credential_id?: string; otpauth_uri?: string }
      if (data.credential_id) setTotpCredId(data.credential_id)
      if (data.otpauth_uri) {
        setTotpQrUrl(
          `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(data.otpauth_uri)}`,
        )
      }
      setStatus('idle')
    } catch {
      setStatus('error')
      setMessage('Could not reach the server.')
    }
  }

  async function runPasskeyCeremony() {
    if (!('PublicKeyCredential' in window)) {
      setMessage('This browser does not support passkeys.')
      return
    }
    setWebauthnBusy(true)
    setMessage(null)
    try {
      const beginPath =
        mfaFlow.mode === 'setup'
          ? '/api/v1/auth/mfa/webauthn/register/begin'
          : '/api/v1/auth/mfa/webauthn/authenticate/begin'
      const res = await fetch(apiUrl(beginPath), {
        method: 'POST',
        headers: { ...authHeaders },
      })
      const raw: unknown = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMessage(readApiErrorMessage(raw))
        setWebauthnBusy(false)
        return
      }
      const data = raw as { session_id?: string; options?: unknown }
      const sessionId = data.session_id
      if (!sessionId || data.options == null) {
        setMessage('Invalid response from server.')
        setWebauthnBusy(false)
        return
      }
      const optsJson = data.options as Parameters<typeof startRegistration>[0]['optionsJSON']
      let credential: unknown
      if (mfaFlow.mode === 'setup') {
        credential = await startRegistration({ optionsJSON: optsJson })
      } else {
        credential = await startAuthentication({ optionsJSON: optsJson })
      }
      const completePath =
        mfaFlow.mode === 'setup'
          ? '/api/v1/auth/mfa/webauthn/register/complete'
          : '/api/v1/auth/mfa/webauthn/authenticate/complete'
      const body =
        mfaFlow.mode === 'setup'
          ? JSON.stringify({ session_id: sessionId, credential, display_name: '' })
          : JSON.stringify({ session_id: sessionId, credential })
      const res2 = await fetch(apiUrl(completePath), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body,
      })
      const raw2: unknown = await res2.json().catch(() => ({}))
      if (!res2.ok) {
        setMessage(readApiErrorMessage(raw2))
        setWebauthnBusy(false)
        return
      }
      if (mfaFlow.mode === 'setup') {
        const out = raw2 as { backup_codes?: string[] }
        if (out.backup_codes?.length) {
          sessionStorage.setItem('mfa_backup_codes_display', JSON.stringify(out.backup_codes))
        }
        await completeSetup()
      } else {
        const out = raw2 as {
          access_token?: string
          refresh_token?: string
          expires_in?: number
          user?: { uiTheme?: string | null }
        }
        await finishWithAccessToken(out, out.user?.uiTheme)
      }
    } catch {
      setMessage('Passkey was cancelled or failed.')
    }
    setWebauthnBusy(false)
  }

  const title = mfaFlow.mode === 'setup' ? 'Set up two-factor authentication' : 'Two-factor authentication'
  const subtitle =
    mfaFlow.mode === 'setup'
      ? 'Your organization requires a second sign-in step. Add an authenticator app or passkey.'
      : 'Enter the code from your authenticator app, use a passkey, or a backup code.'

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-slate-50 px-4 py-12">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(99,102,241,0.12),transparent)]"
        aria-hidden
      />
      <div className="relative z-10 w-full max-w-md">
        <header className="mb-10 text-center">
          <div className="mb-6 flex justify-center px-2">
            <BrandLogo />
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">{title}</h1>
          <p className="mt-2 text-sm text-slate-500">{subtitle}</p>
        </header>

        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm shadow-slate-900/5">
          {mfaFlow.mode === 'setup' && !totpQrUrl && (
            <div className="mb-6 space-y-3">
              <p className="text-sm text-slate-600">Choose how to add two-factor authentication.</p>
              <button
                type="button"
                onClick={() => void startTotpEnrol()}
                disabled={status === 'loading'}
                className="flex w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:border-indigo-300 hover:bg-slate-50 disabled:opacity-60"
              >
                Use authenticator app (QR code)
              </button>
              <button
                type="button"
                onClick={() => void runPasskeyCeremony()}
                disabled={webauthnBusy}
                className="flex w-full items-center justify-center rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:opacity-60"
              >
                {webauthnBusy ? 'Waiting for passkey…' : 'Register a passkey'}
              </button>
            </div>
          )}

          {mfaFlow.mode === 'setup' && totpQrUrl && (
            <div className="mb-6 text-center">
              <p className="mb-3 text-sm text-slate-600">Scan this QR code with your authenticator app.</p>
              <img
                src={totpQrUrl}
                alt="QR code for authenticator enrolment"
                className="mx-auto h-48 w-48 rounded-lg border border-slate-200"
              />
            </div>
          )}

          <form className="space-y-5" onSubmit={onTotpSubmit}>
            <div>
              <label htmlFor="mfa-code" className="mb-1.5 block text-sm font-medium text-slate-700">
                {mfaFlow.mode === 'setup' ? 'Confirm with 6-digit code' : 'One-time code (6 digits)'}
              </label>
              <input
                id="mfa-code"
                name="mfa-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                aria-label="One-time code (6 digits)"
                required={mfaFlow.mode === 'challenge' || totpCredId !== null}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-mono text-lg tracking-widest text-slate-900 outline-none ring-indigo-500/20 focus:border-indigo-400 focus:ring-2"
                placeholder="000000"
              />
            </div>
            {message && (
              <p className="text-sm text-rose-600" role="status">
                {message}
              </p>
            )}
            <button
              type="submit"
              disabled={status === 'loading' || code.length !== 6}
              className="flex w-full items-center justify-center rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {status === 'loading' ? 'Verifying…' : mfaFlow.mode === 'setup' ? 'Confirm enrolment' : 'Continue'}
            </button>
          </form>

          {mfaFlow.mode === 'challenge' && (
            <>
              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center" aria-hidden>
                  <div className="w-full border-t border-slate-200" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-white px-2 text-slate-400">or</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void runPasskeyCeremony()}
                disabled={webauthnBusy}
                className="mb-4 flex w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:border-indigo-300 hover:bg-slate-50 disabled:opacity-60"
              >
                {webauthnBusy ? 'Waiting for passkey…' : 'Use passkey'}
              </button>
              {!showBackup ? (
                <button
                  type="button"
                  className="text-sm font-medium text-indigo-600 hover:text-indigo-500"
                  onClick={() => setShowBackup(true)}
                >
                  Use a backup code instead
                </button>
              ) : (
                <form className="mt-4 space-y-3" onSubmit={onBackupSubmit}>
                  <label htmlFor="backup" className="block text-sm font-medium text-slate-700">
                    Backup code
                  </label>
                  <input
                    id="backup"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-mono text-sm text-slate-900 outline-none focus:border-indigo-400 focus:ring-2"
                    value={backup}
                    onChange={(e) => setBackup(e.target.value.toUpperCase())}
                    autoComplete="off"
                  />
                  <button
                    type="submit"
                    disabled={status === 'loading' || backup.length < 8}
                    className="w-full rounded-xl bg-slate-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
                  >
                    Use backup code
                  </button>
                </form>
              )}
            </>
          )}

          <p className="mt-6 text-center text-sm text-slate-500">
            <Link
              to="/login"
              className="font-medium text-indigo-600 hover:text-indigo-500"
              onClick={() => clearMfaFlow()}
            >
              Cancel and use a different account
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
