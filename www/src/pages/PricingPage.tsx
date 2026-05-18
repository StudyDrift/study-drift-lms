import { ArrowRight, Check, Minus } from 'lucide-react'
import { Header } from '../components/Header'

const LINKS = {
  demo: 'https://demo.lextures.com/',
  github: 'https://github.com/StudyDrift/lextures',
} as const

const FREE_FEATURES = [
  'Adaptive quiz delivery (IRT)',
  'AI-generated questions & rubrics',
  'Standards-based gradebook',
  '14+ question types',
  'Course blueprints',
  'Accommodations management',
  'Audit-ready grading log',
]

const EDUCATION_EXTRAS = [
  'LTI 1.3 / Canvas import',
  'SSO (SAML 2.0, OIDC, Clever, ClassLink)',
  'Misconception detection',
  'Spaced repetition scheduler',
  'Priority support',
]

type FeatureRow = {
  label: string
  free: boolean
  education: boolean
}

const COMPARISON: FeatureRow[] = [
  { label: 'Adaptive quiz delivery (IRT)', free: true, education: true },
  { label: 'AI-generated questions & rubrics', free: true, education: true },
  { label: 'Standards-based gradebook', free: true, education: true },
  { label: '14+ question types', free: true, education: true },
  { label: 'Course blueprints', free: true, education: true },
  { label: 'Accommodations management', free: true, education: true },
  { label: 'Audit-ready grading log', free: true, education: true },
  { label: 'LTI 1.3 / Canvas import', free: false, education: true },
  { label: 'SSO (SAML 2.0, OIDC, Clever, ClassLink)', free: false, education: true },
  { label: 'Misconception detection', free: false, education: true },
  { label: 'Spaced repetition scheduler', free: false, education: true },
  { label: 'Priority support', free: false, education: true },
]

const FAQS = [
  {
    q: 'Does a student in two of my courses count twice?',
    a: 'No. Billing is based on unique students across all your courses. A student enrolled in three of your courses counts as one student.',
  },
  {
    q: 'What happens when I exceed 30 students on the free tier?',
    a: 'Enrolling a 31st student prompts an upgrade to Education. No existing students are removed and no data is lost.',
  },
  {
    q: 'What happens when I exceed 5 courses on the free tier?',
    a: 'Creating a 6th course prompts an upgrade. All existing courses and their data remain intact.',
  },
  {
    q: 'Is there institutional or district pricing?',
    a: 'Yes. Deployments of 500+ students are negotiated separately — contact us for a quote.',
  },
  {
    q: 'Can I self-host for free?',
    a: 'Yes. Lextures is open source under AGPL-3.0. Self-hosted deployments have no student or course limits and no licensing fees.',
  },
]

function FeatureLine({ label }: { label: string }) {
  return (
    <li className="flex items-start gap-2.5">
      <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
      <span className="text-sm text-stone-700">{label}</span>
    </li>
  )
}

function ComparisonCell({ included }: { included: boolean }) {
  return included ? (
    <td className="px-6 py-3.5 text-center">
      <Check className="mx-auto h-4 w-4 text-accent" aria-label="Included" />
    </td>
  ) : (
    <td className="px-6 py-3.5 text-center">
      <Minus className="mx-auto h-4 w-4 text-stone-300" aria-label="Not included" />
    </td>
  )
}

export function PricingPage() {
  return (
    <div className="relative min-h-screen overflow-x-hidden bg-stone-50 text-slate-700">
      <Header />

      <main>
        {/* Hero */}
        <section className="border-b border-stone-200/90 bg-white py-16 sm:py-20">
          <div className="mx-auto max-w-3xl px-4 text-center sm:px-6 lg:px-8">
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.3em] text-stone-500">
              Pricing
            </p>
            <h1 className="mt-5 text-4xl font-semibold tracking-tight text-stone-900 sm:text-5xl">
              Free until you need to scale
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-stone-600">
              Full-featured for small courses. Pay only when you grow beyond 30 students or 5 courses—and then only $9.99 per student per year.
            </p>
          </div>
        </section>

        {/* Tier cards */}
        <section className="py-16 sm:py-20">
          <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
            <div className="grid gap-6 lg:grid-cols-2 lg:items-start">

              {/* Free */}
              <div className="rounded-2xl border border-stone-200/90 bg-white p-8 shadow-[0_1px_4px_rgba(28,25,23,0.06)]">
                <div>
                  <p className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-stone-400">Free</p>
                  <div className="mt-3 flex items-baseline gap-1">
                    <span className="text-5xl font-semibold tracking-tight text-stone-900">$0</span>
                    <span className="text-sm text-stone-500">forever</span>
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-stone-500">
                    No trial period, no credit card required. Ideal for a single class section or a pilot course.
                  </p>
                </div>

                <div className="mt-6 space-y-2 rounded-lg bg-stone-50 px-4 py-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-stone-600">Students per course</span>
                    <span className="font-semibold text-stone-900">Up to 30</span>
                  </div>
                  <div className="flex justify-between border-t border-stone-100 pt-2">
                    <span className="text-stone-600">Courses</span>
                    <span className="font-semibold text-stone-900">Up to 5</span>
                  </div>
                </div>

                <ul className="mt-6 space-y-3">
                  {FREE_FEATURES.map((f) => <FeatureLine key={f} label={f} />)}
                </ul>

                <a href={LINKS.demo} className="btn-secondary mt-8 w-full justify-center">
                  Try the demo
                </a>
              </div>

              {/* Education */}
              <div className="rounded-2xl border-2 border-accent bg-white p-8 shadow-[0_4px_24px_rgba(15,118,110,0.12)]">
                <div>
                  <div className="flex items-center justify-between">
                    <p className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-accent">Education</p>
                    <span className="rounded-full bg-accent-muted px-2.5 py-0.5 text-xs font-semibold text-accent">
                      Most popular
                    </span>
                  </div>
                  <div className="mt-3 flex items-baseline gap-1">
                    <span className="text-5xl font-semibold tracking-tight text-stone-900">$9.99</span>
                    <span className="text-sm text-stone-500">/ student / year</span>
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-stone-500">
                    Billed annually based on unique enrolled students across all your courses. Unlimited courses included.
                  </p>
                </div>

                <div className="mt-6 space-y-2 rounded-lg bg-stone-50 px-4 py-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-stone-600">Students per course</span>
                    <span className="font-semibold text-stone-900">Unlimited</span>
                  </div>
                  <div className="flex justify-between border-t border-stone-100 pt-2">
                    <span className="text-stone-600">Courses</span>
                    <span className="font-semibold text-stone-900">Unlimited</span>
                  </div>
                </div>

                <ul className="mt-6 space-y-3">
                  {FREE_FEATURES.map((f) => <FeatureLine key={f} label={f} />)}
                  <li className="border-t border-stone-100 pt-3">
                    <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-stone-400">
                      Also includes
                    </p>
                    <ul className="space-y-3">
                      {EDUCATION_EXTRAS.map((f) => <FeatureLine key={f} label={f} />)}
                    </ul>
                  </li>
                </ul>

                <a href="#/get-started" className="btn-primary mt-8 w-full justify-center gap-2">
                  Get Started
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </a>
              </div>
            </div>

            {/* Example calculation */}
            <div className="mt-10 rounded-xl border border-stone-200/90 bg-white px-6 py-5">
              <p className="text-sm font-semibold text-stone-900">Example</p>
              <p className="mt-1 text-sm leading-relaxed text-stone-600">
                An instructor with 3 courses and 90 unique enrolled students pays{' '}
                <span className="font-semibold text-stone-900">90 × $9.99 = $897.10 / year</span>.
                A student taking two of those courses counts as one.
              </p>
            </div>
          </div>
        </section>

        {/* Feature comparison table */}
        <section className="border-t border-stone-200/90 bg-white py-16 sm:py-20">
          <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl font-semibold tracking-tight text-stone-900 sm:text-3xl">
              Full feature comparison
            </h2>
            <div className="mt-8 overflow-x-auto rounded-xl border border-stone-200/90">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-stone-200/90 bg-stone-50">
                    <th className="px-6 py-4 text-left font-semibold text-stone-900">Feature</th>
                    <th className="px-6 py-4 text-center font-semibold text-stone-900">Free</th>
                    <th className="px-6 py-4 text-center font-semibold text-accent">Education</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {COMPARISON.map((row) => (
                    <tr key={row.label} className="bg-white transition-colors hover:bg-stone-50/60">
                      <td className="px-6 py-3.5 text-stone-700">{row.label}</td>
                      <ComparisonCell included={row.free} />
                      <ComparisonCell included={row.education} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="border-t border-stone-200/90 bg-stone-50 py-16 sm:py-20">
          <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl font-semibold tracking-tight text-stone-900 sm:text-3xl">
              Common questions
            </h2>
            <dl className="mt-8 divide-y divide-stone-200/90">
              {FAQS.map(({ q, a }) => (
                <div key={q} className="py-6">
                  <dt className="font-semibold text-stone-900">{q}</dt>
                  <dd className="mt-2 text-sm leading-relaxed text-stone-600">{a}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* CTA */}
        <section className="border-t border-stone-200/90 bg-white py-16 sm:py-20">
          <div className="mx-auto max-w-3xl px-4 text-center sm:px-6 lg:px-8">
            <h2 className="text-2xl font-semibold tracking-tight text-stone-900 sm:text-3xl">
              See it before you commit
            </h2>
            <p className="mx-auto mt-4 max-w-md text-base leading-relaxed text-stone-600">
              The live demo has full instructor and learner flows — quizzes, gradebook, imports, and adaptive delivery.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a href="#/get-started" className="btn-primary gap-2 px-6 py-3">
                Get Started
                <ArrowRight className="h-4 w-4" aria-hidden />
              </a>
              <a href={LINKS.github} className="btn-secondary px-6 py-3">
                Browse the source
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-stone-200/90 bg-white py-10">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <p className="text-sm text-stone-400">© {new Date().getFullYear()} Lextures contributors</p>
        </div>
      </footer>
    </div>
  )
}
