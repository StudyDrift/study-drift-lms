import { type FormEvent, useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { BrandLogo } from '../components/brand-logo'
import { OidcSignInButtons } from '../components/oidc-sign-in-buttons'
import { getAccessToken } from '../lib/auth'
import { applyAuthTokenResponse } from '../lib/session-tokens'
import { apiUrl } from '../lib/api'
import { readApiErrorMessage } from '../lib/errors'
import { passwordStrengthEnglish, passwordStrengthKey, type PasswordStrengthKey } from '../lib/password-strength'
import { applyUiTheme, parseUiTheme } from '../lib/ui-theme'
import { markPostLoginShortcutTip } from '../lib/post-login-shortcut-tip'
import {
  authCardClass,
  authFieldClass,
  authMutedLinkClass,
  authPrimaryButtonClass,
} from '../components/auth/auth-field-classes'
import { PublicAuthShell } from '../components/auth/public-auth-shell'

export default function Signup() {
  const navigate = useNavigate()
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
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
        /* ignore — server enforces policy */
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
    setStatus('loading')
    setMessage(null)
    try {
      const res = await fetch(apiUrl('/api/v1/auth/signup'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          display_name: displayName || undefined,
        }),
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
      const data = raw as { access_token: string; user?: { uiTheme?: string | null } }
      applyAuthTokenResponse(data)
      applyUiTheme(parseUiTheme(data.user?.uiTheme))
      markPostLoginShortcutTip()
      navigate('/', { replace: true })
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
          Create your account
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-stone-600 dark:text-neutral-400">
          One account for courses, assignments, and messages. If your school uses SSO, you can sign in that way later.
        </p>
      </header>

      <div className={authCardClass}>
        <OidcSignInButtons nextPath="/" />
        <form className="mt-4 space-y-5" onSubmit={onSubmit}>
            <div>
              <label
                htmlFor="displayName"
                className="mb-1.5 block text-sm font-medium text-stone-800 dark:text-neutral-200"
              >
                Display name <span className="font-normal text-stone-500 dark:text-neutral-500">(optional)</span>
              </label>
              <input
                id="displayName"
                name="displayName"
                type="text"
                autoComplete="nickname"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className={authFieldClass}
                placeholder="Alex"
              />
            </div>
            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-stone-800 dark:text-neutral-200">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={authFieldClass}
                placeholder="you@school.edu"
              />
            </div>
            <div>
              <label
                htmlFor="password"
                className="mb-1.5 block text-sm font-medium text-stone-800 dark:text-neutral-200"
              >
                Password
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

            {message && (
              <p className="text-sm text-rose-600 dark:text-rose-400" role="status">
                {message}
              </p>
            )}

            <button type="submit" disabled={status === 'loading'} className={authPrimaryButtonClass}>
              {status === 'loading' ? 'Creating account…' : 'Create account'}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-stone-600 dark:text-neutral-400">
            Already have an account?{' '}
            <Link to="/login" className={authMutedLinkClass}>
              Sign in
            </Link>
          </p>
        </div>
    </PublicAuthShell>
  )
}
