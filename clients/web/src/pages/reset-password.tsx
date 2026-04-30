import { type FormEvent, useEffect, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { BrandLogo } from '../components/brand-logo'
import { getAccessToken } from '../lib/auth'
import { apiUrl } from '../lib/api'
import { readApiErrorMessage } from '../lib/errors'
import { passwordStrengthEnglish, passwordStrengthKey, type PasswordStrengthKey } from '../lib/password-strength'

export default function ResetPassword() {
  const [searchParams] = useSearchParams()
  const tokenFromUrl = searchParams.get('token') ?? ''

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'done'>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [policy, setPolicy] = useState<{
    minLength: number
    requireUpper: boolean
    requireLower: boolean
    requireDigit: boolean
    requireSpecial: boolean
    checkHibp: boolean
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(apiUrl('/api/v1/auth/password-policy'))
        const raw: unknown = await res.json().catch(() => ({}))
        if (!res.ok || cancelled) return
        const p = raw as {
          minLength?: number
          requireUpper?: boolean
          requireLower?: boolean
          requireDigit?: boolean
          requireSpecial?: boolean
          checkHibp?: boolean
        }
        setPolicy({
          minLength: typeof p.minLength === 'number' ? p.minLength : 8,
          requireUpper: !!p.requireUpper,
          requireLower: !!p.requireLower,
          requireDigit: !!p.requireDigit,
          requireSpecial: !!p.requireSpecial,
          checkHibp: p.checkHibp !== false,
        })
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const minLen = policy?.minLength ?? 8
  const strengthKey: PasswordStrengthKey = passwordStrengthKey(password)
  const strengthLabel = passwordStrengthEnglish(strengthKey)

  if (getAccessToken()) {
    return <Navigate to="/" replace />
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setMessage(null)
    if (!tokenFromUrl.trim()) {
      setStatus('error')
      setMessage('This page needs a valid reset link. Open the link from your email.')
      return
    }
    if (password !== confirm) {
      setStatus('error')
      setMessage('Passwords do not match.')
      return
    }
    if (password.length < minLen) {
      setStatus('error')
      setMessage(`Password must be at least ${minLen} characters.`)
      return
    }

    setStatus('loading')
    try {
      const res = await fetch(apiUrl('/api/v1/auth/reset-password'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tokenFromUrl, password }),
      })
      let raw: unknown
      try {
        raw = await res.json()
      } catch {
        raw = {}
      }
      if (!res.ok) {
        setStatus('error')
        setMessage(readApiErrorMessage(raw))
        return
      }
      const data = raw as { message?: string }
      setStatus('done')
      setMessage(data.message ?? 'Your password has been updated.')
    } catch {
      setStatus('error')
      setMessage('Could not reach the server. Is the API running?')
    }
  }

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
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Set a new password</h1>
          <p className="mt-2 text-sm text-slate-500">Choose a strong password you have not used elsewhere.</p>
        </header>

        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm shadow-slate-900/5">
          {status === 'done' ? (
            <div className="space-y-4 text-center">
              <p className="text-sm text-slate-700" role="status">
                {message}
              </p>
              <Link
                to="/login"
                className="inline-block text-sm font-medium text-indigo-600 hover:text-indigo-500"
              >
                Sign in
              </Link>
            </div>
          ) : (
            <form className="space-y-5" onSubmit={onSubmit}>
              {!tokenFromUrl.trim() && (
                <p className="text-sm text-amber-700" role="status">
                  Missing token. Use the link from your reset email, or request a new link from the sign-in page.
                </p>
              )}
              <div>
                <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-slate-700">
                  New password
                </label>
                <ul id="password-requirements" className="mb-2 list-inside list-disc text-xs text-slate-600">
                  <li>At least {minLen} characters</li>
                  {policy?.requireUpper ? <li>One uppercase letter</li> : null}
                  {policy?.requireLower ? <li>One lowercase letter</li> : null}
                  {policy?.requireDigit ? <li>One digit</li> : null}
                  {policy?.requireSpecial ? <li>One symbol or punctuation character</li> : null}
                  {policy == null || policy.checkHibp ? (
                    <li>Must not appear in known public breach lists (checked securely)</li>
                  ) : null}
                </ul>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={minLen}
                  aria-invalid={status === 'error' && message != null}
                  aria-describedby="password-requirements password-strength"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-slate-900 outline-none ring-indigo-500/20 transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2"
                  placeholder={`At least ${minLen} characters`}
                />
                <div id="password-strength" className="mt-2 flex items-center gap-2" aria-live="polite">
                  <span className="text-xs font-medium text-slate-600">Strength:</span>
                  <span className="text-xs font-semibold text-slate-800">{strengthLabel}</span>
                  <div className="h-1.5 flex-1 rounded-full bg-slate-200" aria-hidden>
                    <div
                      className={`h-full rounded-full ${
                        strengthKey === 'password.strength.weak'
                          ? 'w-1/3 bg-rose-500'
                          : strengthKey === 'password.strength.fair'
                            ? 'w-2/3 bg-amber-500'
                            : 'w-full bg-emerald-600'
                      }`}
                    />
                  </div>
                </div>
              </div>
              <div>
                <label htmlFor="confirm" className="mb-1.5 block text-sm font-medium text-slate-700">
                  Confirm password
                </label>
                <input
                  id="confirm"
                  name="confirm"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={minLen}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-slate-900 outline-none ring-indigo-500/20 transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2"
                  placeholder="Repeat password"
                />
              </div>

              {message && status === 'error' && (
                <p className="text-sm text-rose-600" role="status">
                  {message}
                </p>
              )}

              <button
                type="submit"
                disabled={status === 'loading' || !tokenFromUrl.trim()}
                className="flex w-full items-center justify-center rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {status === 'loading' ? 'Updating…' : 'Update password'}
              </button>
            </form>
          )}

          {status !== 'done' && (
            <p className="mt-6 text-center text-sm text-slate-500">
              <Link to="/login" className="font-medium text-indigo-600 hover:text-indigo-500">
                Back to sign in
              </Link>
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
