import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Terminal } from 'lucide-react'
import { authorizedFetch } from '../lib/api'
import { readApiErrorMessage } from '../lib/errors'

type Status = 'idle' | 'approving' | 'approved' | 'error'

export default function CliAuthPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''

  const [status, setStatus] = useState<Status>(() => (token.trim() === '' ? 'error' : 'idle'))
  const [errorMsg, setErrorMsg] = useState<string | null>(() =>
    token.trim() === '' ? 'No token found in the URL. Return to your terminal and try again.' : null,
  )

  async function handleApprove() {
    setStatus('approving')
    try {
      const res = await authorizedFetch('/api/v1/auth/cli/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      if (!res.ok) {
        let raw: unknown
        try {
          raw = await res.json()
        } catch {
          raw = {}
        }
        setErrorMsg(readApiErrorMessage(raw))
        setStatus('error')
        return
      }
      setStatus('approved')
    } catch {
      setErrorMsg('Could not reach the server.')
      setStatus('error')
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
          <Terminal className="h-6 w-6" aria-hidden />
        </div>

        {status === 'approved' ? (
          <>
            <h1 className="text-xl font-semibold text-slate-900">CLI access granted</h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-500">
              You can close this tab. Your terminal should now be authenticated.
            </p>
          </>
        ) : status === 'error' ? (
          <>
            <h1 className="text-xl font-semibold text-slate-900">Something went wrong</h1>
            <p className="mt-2 text-sm text-rose-600" role="alert">
              {errorMsg}
            </p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold text-slate-900">Approve CLI access</h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-500">
              A Lextures CLI session is requesting access to your account. Only approve if you
              initiated this from your terminal.
            </p>
            <button
              type="button"
              onClick={handleApprove}
              disabled={status === 'approving'}
              className="mt-6 w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              {status === 'approving' ? 'Approving…' : 'Approve'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
