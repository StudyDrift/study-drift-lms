import { type FormEvent, useEffect, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import {
  authCardClass,
  authFieldClass,
  authMutedLinkClass,
  authPrimaryButtonClass,
} from '../components/auth/auth-field-classes'
import { PublicAuthShell } from '../components/auth/public-auth-shell'
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
    <PublicAuthShell>
      <header className="mb-8 text-center">
        <div className="mb-5 flex justify-center px-2">
          <BrandLogo className="mx-auto h-14 w-auto max-w-[min(100%,240px)] object-contain" />
        </div>
        <h1 className="lex-auth-display text-[1.7rem] leading-snug text-stone-900 dark:text-neutral-50">
          Set a new password
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-stone-600 dark:text-neutral-400">
          Choose a strong password you have not used on other sites.
        </p>
      </header>

      <div className={authCardClass}>
        {status === 'done' ? (
          <div className="space-y-4 text-center">
            <p className="text-sm text-stone-700 dark:text-neutral-300" role="status">
              {message}
            </p>
            <Link to="/login" className={`inline-block text-sm ${authMutedLinkClass}`}>
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
                <label
                  htmlFor="password"
                  className="mb-1.5 block text-sm font-medium text-stone-800 dark:text-neutral-200"
                >
                  New password
                </label>
                <ul
                  id="password-requirements"
                  className="mb-2 list-inside list-disc text-xs text-stone-600 dark:text-neutral-400"
                >
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
                  className={authFieldClass}
                  placeholder={`At least ${minLen} characters`}
                />
                <div id="password-strength" className="mt-2 flex items-center gap-2" aria-live="polite">
                  <span className="text-xs font-medium text-stone-600 dark:text-neutral-400">Strength:</span>
                  <span className="text-xs font-semibold text-stone-800 dark:text-neutral-200">{strengthLabel}</span>
                  <div className="h-1.5 flex-1 rounded-full bg-stone-200 dark:bg-neutral-700" aria-hidden>
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
                <label
                  htmlFor="confirm"
                  className="mb-1.5 block text-sm font-medium text-stone-800 dark:text-neutral-200"
                >
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
                  className={authFieldClass}
                  placeholder="Repeat password"
                />
              </div>

              {message && status === 'error' && (
                <p className="text-sm text-rose-600 dark:text-rose-400" role="status">
                  {message}
                </p>
              )}

              <button
                type="submit"
                disabled={status === 'loading' || !tokenFromUrl.trim()}
                className={authPrimaryButtonClass}
              >
                {status === 'loading' ? 'Updating…' : 'Update password'}
              </button>
            </form>
          )}

          {status !== 'done' && (
            <p className="mt-6 text-center text-sm text-stone-600 dark:text-neutral-400">
              <Link to="/login" className={authMutedLinkClass}>
                Back to sign in
              </Link>
            </p>
          )}
        </div>
    </PublicAuthShell>
  )
}
