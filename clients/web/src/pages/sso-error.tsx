import { Link, useSearchParams } from 'react-router-dom'
import { BrandLogo } from '../components/brand-logo'

/** Friendly page when SAML / institutional sign-in cannot be completed. */
export default function SsoError() {
  const [params] = useSearchParams()
  const reason = params.get('reason') ?? 'sign_in_failed'

  const text =
    reason === 'forbidden' || reason === 'access_denied'
      ? 'Your institution denied access, or you cancelled sign-in. You can try again or use email and password if your account has one.'
      : 'We could not finish signing you in with your institution. Please try again, or use email and password if your school allows it.'

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-slate-50 px-4 py-12">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(99,102,241,0.12),transparent)]"
        aria-hidden
      />
      <div className="relative z-10 w-full max-w-md text-center">
        <div className="mb-6 flex justify-center px-2">
          <BrandLogo />
        </div>
        <h1 className="text-2xl font-semibold text-slate-900">Sign-in could not be completed</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">{text}</p>
        <div className="mt-8">
          <Link
            to="/login"
            className="inline-flex rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500"
          >
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  )
}
