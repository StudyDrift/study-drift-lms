import { type FormEvent, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
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

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'sent'>('idle')
  const [message, setMessage] = useState<string | null>(null)

  if (getAccessToken()) {
    return <Navigate to="/" replace />
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setStatus('loading')
    setMessage(null)
    try {
      const res = await fetch(apiUrl('/api/v1/auth/forgot-password'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
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
      setStatus('sent')
      setMessage(data.message ?? 'Check your email for a reset link.')
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
          Forgot password
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-stone-600 dark:text-neutral-400">
          Enter your email. If there is an account for it, you will receive a reset link shortly.
        </p>
      </header>

      <div className={authCardClass}>
        {status === 'sent' ? (
          <div className="space-y-4 text-center">
            <p className="text-sm text-stone-700 dark:text-neutral-300" role="status">
              {message}
            </p>
            <Link to="/login" className={`inline-block text-sm ${authMutedLinkClass}`}>
              Back to sign in
            </Link>
          </div>
        ) : (
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

            {message && status === 'error' && (
              <p className="text-sm text-rose-600 dark:text-rose-400" role="status">
                {message}
              </p>
            )}

            <button type="submit" disabled={status === 'loading'} className={authPrimaryButtonClass}>
              {status === 'loading' ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
        )}

        {status !== 'sent' && (
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
