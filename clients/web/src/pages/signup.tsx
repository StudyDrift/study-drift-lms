import { type FormEvent, useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { BrandLogo } from '../components/brand-logo'
import { OidcSignInButtons } from '../components/oidc-sign-in-buttons'
import { getAccessToken, setAccessToken } from '../lib/auth'
import { apiUrl } from '../lib/api'
import { readApiErrorMessage } from '../lib/errors'
import { passwordStrengthEnglish, passwordStrengthKey, type PasswordStrengthKey } from '../lib/password-strength'
import { applyUiTheme, parseUiTheme } from '../lib/ui-theme'
import { markPostLoginShortcutTip } from '../lib/post-login-shortcut-tip'

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
      setAccessToken(data.access_token)
      applyUiTheme(parseUiTheme(data.user?.uiTheme))
      markPostLoginShortcutTip()
      navigate('/', { replace: true })
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
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Create your account</h1>
          <p className="mt-2 text-sm text-slate-500">Start learning with a calm, focused workspace.</p>
        </header>

        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm shadow-slate-900/5">
          <OidcSignInButtons nextPath="/" />
          <form className="mt-4 space-y-5" onSubmit={onSubmit}>
            <div>
              <label htmlFor="displayName" className="mb-1.5 block text-sm font-medium text-slate-700">
                Display name <span className="font-normal text-slate-500">(optional)</span>
              </label>
              <input
                id="displayName"
                name="displayName"
                type="text"
                autoComplete="nickname"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-slate-900 outline-none ring-indigo-500/20 transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2"
                placeholder="Alex"
              />
            </div>
            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-slate-700">
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
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-slate-900 outline-none ring-indigo-500/20 transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2"
                placeholder="you@school.edu"
              />
            </div>
            <div>
              <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-slate-700">
                Password
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

            {message && (
              <p className="text-sm text-rose-600" role="status">
                {message}
              </p>
            )}

            <button
              type="submit"
              disabled={status === 'loading'}
              className="flex w-full items-center justify-center rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {status === 'loading' ? 'Creating account…' : 'Create account'}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-slate-500">
            Already have an account?{' '}
            <Link to="/login" className="font-medium text-indigo-600 hover:text-indigo-500">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
