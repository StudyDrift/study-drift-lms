import { type FormEvent, useEffect, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { BrandLogo } from '../components/brand-logo'
import { OidcSignInButtons } from '../components/oidc-sign-in-buttons'
import { getAccessToken } from '../lib/auth'
import { applyAuthTokenResponse } from '../lib/session-tokens'
import { pickPostAuthPath } from '../lib/post-auth-redirect'
import { apiUrl } from '../lib/api'
import { readApiErrorMessage } from '../lib/errors'
import { applyUiTheme, parseUiTheme } from '../lib/ui-theme'
import { markPostLoginShortcutTip } from '../lib/post-login-shortcut-tip'
import { setMfaFlow } from '../lib/mfa-flow-storage'
import {
  authCardClass,
  authFieldClass,
  authMutedLinkClass,
  authOutlineButtonClass,
  authPrimaryButtonClass,
} from '../components/auth/auth-field-classes'
import { MagicLinkRequestForm } from '../components/auth/magic-link-request-form'
import { PublicAuthShell } from '../components/auth/public-auth-shell'

export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as { from?: string } | undefined
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

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [saml, setSaml] = useState<{
    enabled: boolean
    idp?: { id: string; label: string; forceSaml: boolean }
  } | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch(apiUrl('/api/v1/auth/saml/status'))
        const raw: unknown = await res.json().catch(() => ({}))
        if (!alive) return
        const o = raw as {
          enabled?: boolean
          idp?: { id: string; label: string; forceSaml: boolean }
        }
        if (o.enabled && o.idp) {
          setSaml({ enabled: true, idp: o.idp })
        } else if (o.enabled) {
          setSaml({ enabled: true })
        } else {
          setSaml({ enabled: false })
        }
      } catch {
        if (alive) setSaml({ enabled: false })
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  if (getAccessToken()) {
    return <Navigate to="/" replace />
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setStatus('loading')
    setMessage(null)
    try {
      const res = await fetch(apiUrl('/api/v1/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
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
      const data = raw as {
        access_token?: string
        mfa_pending_token?: string
        requires_mfa?: boolean
        mfa_setup_required?: boolean
        user?: { email?: string; uiTheme?: string | null; accountType?: string }
      }
      if (data.requires_mfa && data.mfa_pending_token) {
        setMfaFlow({ token: data.mfa_pending_token, mode: 'challenge' })
        navigate('/login/mfa', { replace: true, state: { from } })
        return
      }
      if (data.mfa_setup_required && data.mfa_pending_token) {
        setMfaFlow({ token: data.mfa_pending_token, mode: 'setup' })
        navigate('/login/mfa', { replace: true, state: { from } })
        return
      }
      if (!data.access_token) {
        setStatus('error')
        setMessage('Unexpected sign-in response.')
        return
      }
      applyAuthTokenResponse(data)
      applyUiTheme(parseUiTheme(data.user?.uiTheme))
      markPostLoginShortcutTip()
      navigate(pickPostAuthPath(from), { replace: true })
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
          Sign in
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-stone-600 dark:text-neutral-400">
          Use the email your course or school uses. SSO options appear when your organization connects them.
        </p>
      </header>

      <div className={authCardClass}>
        <OidcSignInButtons nextPath={from} />
        {saml?.enabled && saml.idp && (
          <div className="mb-6">
            <a
              className={authOutlineButtonClass}
              href={apiUrl(
                `/auth/saml/login?idpId=${encodeURIComponent(saml.idp.id)}&RelayState=${encodeURIComponent(from)}`,
              )}
              aria-label="Log in with institutional single sign-on"
            >
              Log in with {saml.idp.label} SSO
            </a>
          </div>
        )}
        {saml?.enabled && saml.idp?.forceSaml && (
          <p className="mb-4 text-center text-sm text-stone-600 dark:text-neutral-400">
            Your organization requires institutional sign-in.
          </p>
        )}
        {!saml?.idp?.forceSaml && (
          <form className="space-y-5" onSubmit={onSubmit}>
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
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={authFieldClass}
                placeholder="••••••••"
              />
              <div className="mt-2 text-right">
                <Link to="/forgot-password" className={`text-sm ${authMutedLinkClass}`}>
                  Forgot password?
                </Link>
              </div>
            </div>

            {message && (
              <p className="text-sm text-rose-600 dark:text-rose-400" role="status">
                {message}
              </p>
            )}

            <button type="submit" disabled={status === 'loading'} className={authPrimaryButtonClass}>
              {status === 'loading' ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        )}

        {!saml?.idp?.forceSaml && <MagicLinkRequestForm redirectTo={from} defaultEmail={email} />}

        {!saml?.idp?.forceSaml && (
          <p className="mt-6 text-center text-sm text-stone-600 dark:text-neutral-400">
            New here?{' '}
            <Link to="/signup" className={authMutedLinkClass}>
              Create an account
            </Link>
          </p>
        )}
      </div>
    </PublicAuthShell>
  )
}
