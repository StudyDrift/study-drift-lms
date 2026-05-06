import {
  ArrowRight,
  BarChart3,
  BookOpen,
  GraduationCap,
  Menu,
  Plug,
  Shield,
  Users,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'

const LINKS = {
  demo: 'https://demo.lextures.com/',
  github: 'https://github.com/StudyDrift/lextures',
} as const

const NAV = [
  { label: 'Product', href: '#product' },
  { label: 'Institutions', href: '#institutions' },
  { label: 'Integrations', href: '#integrations' },
  { label: 'Demo', href: LINKS.demo },
] as const

const FEATURES = [
  {
    title: 'Courses that stay organized',
    body: 'Structure units, lessons, and files so learners always know what is due next—without turning your catalog into a maze.',
    icon: BookOpen,
  },
  {
    title: 'Assessment with guardrails',
    body: 'Ship quizzes and assignments with clear rubrics, revision paths, and grading workflows instructors can trust at scale.',
    icon: GraduationCap,
  },
  {
    title: 'Built for real rosters',
    body: 'Designed around sections, roles, and institutional boundaries so the right people see the right courses by default.',
    icon: Users,
  },
  {
    title: 'Operational visibility',
    body: 'Surface progress and workload early—so teams can intervene with context instead of chasing spreadsheets after the fact.',
    icon: BarChart3,
  },
  {
    title: 'Privacy-minded by design',
    body: 'Treat student data as a liability to minimize, not a commodity to monetize. FERPA-shaped instincts are table stakes.',
    icon: Shield,
  },
  {
    title: 'Interoperable stack',
    body: 'Meet schools where their tools already live—LTI launches, roster signals, and the boring plumbing that keeps IT calm.',
    icon: Plug,
  },
] as const

function LogoMark({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      aria-hidden
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="32" height="32" rx="8" fill="#4f46e5" />
      <path
        d="M9 23V9h5.2c2.9 0 5.1 1.6 5.1 4.2 0 2.5-2.2 4.1-5.1 4.1H12.5V23H9Zm3.5-8.2h1.4c1.4 0 2.3-.7 2.3-1.8 0-1.2-.9-1.9-2.3-1.9h-1.4v3.7Z"
        fill="white"
      />
    </svg>
  )
}

export default function App() {
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [menuOpen])

  const closeMenu = () => setMenuOpen(false)

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-white text-slate-700">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-indigo-600 focus:px-4 focus:py-2 focus:text-sm focus:text-white"
      >
        Skip to content
      </a>

      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <a href="#" className="flex items-center gap-2.5 no-underline">
            <LogoMark className="h-8 w-8 shrink-0" />
            <span className="text-base font-semibold text-slate-900 tracking-tight">Lextures</span>
          </a>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
            {NAV.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="rounded-md px-3 py-2 text-sm font-medium text-slate-600 no-underline transition-colors hover:bg-slate-100 hover:text-slate-900"
              >
                {item.label}
              </a>
            ))}
          </nav>

          <div className="hidden items-center gap-3 md:flex">
            <a href={LINKS.github} className="btn-secondary">
              Source
            </a>
            <a href={LINKS.demo} className="btn-primary">
              Try the demo
            </a>
          </div>

          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 text-slate-600 transition hover:bg-slate-100 md:hidden"
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            aria-label="Open menu"
          >
            <Menu className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Mobile nav */}
      {menuOpen && (
        <div
          className="fixed inset-0 z-[60] flex flex-col bg-white md:hidden"
          id="mobile-nav"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
        >
          <div className="flex h-16 items-center justify-between border-b border-slate-200 px-4">
            <div className="flex items-center gap-2.5">
              <LogoMark className="h-8 w-8" />
              <span className="text-base font-semibold text-slate-900">Lextures</span>
            </div>
            <button
              type="button"
              onClick={closeMenu}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100"
              aria-label="Close menu"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <nav className="flex flex-1 flex-col gap-1 p-4" aria-label="Mobile primary">
            {NAV.map((item) => (
              <a
                key={item.href}
                href={item.href}
                onClick={closeMenu}
                className="rounded-lg px-4 py-3.5 text-base font-medium text-slate-700 no-underline transition hover:bg-slate-100"
              >
                {item.label}
              </a>
            ))}
          </nav>
          <div className="border-t border-slate-200 p-4 pb-8 flex flex-col gap-3">
            <a href={LINKS.demo} onClick={closeMenu} className="btn-primary w-full justify-center">
              Try the demo
            </a>
            <a href={LINKS.github} onClick={closeMenu} className="btn-secondary w-full justify-center">
              View on GitHub
            </a>
          </div>
        </div>
      )}

      <main id="main">
        {/* Hero */}
        <section className="border-b border-slate-200 py-20 sm:py-28 lg:py-32">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <p className="text-xs font-semibold uppercase tracking-widest text-indigo-600">
              Open-source learning management
            </p>
            <h1 className="mt-5 max-w-3xl font-display text-4xl font-normal italic leading-[1.1] tracking-tight text-slate-900 sm:text-5xl lg:text-[3.25rem]">
              Calm software for{' '}
              <span className="not-italic text-indigo-600">courses, cohorts, and credentials</span>
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-slate-600 sm:text-xl">
              Lextures is an LMS built for institutions that cannot afford toy-grade reliability—where
              roster truth, accessible content, and defensible grading matter as much as the syllabus.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
              <a href={LINKS.demo} className="btn-primary gap-2">
                Open the live demo
                <ArrowRight className="h-4 w-4" aria-hidden />
              </a>
              <a href={LINKS.github} className="btn-secondary">
                Browse the repository
              </a>
            </div>
            <p className="mt-8 text-sm text-slate-400">
              Prefer to self-host or extend? The application stack is MIT-licensed—bring your own Postgres
              and ship on your timeline.
            </p>
          </div>
        </section>

        {/* Product pillars */}
        <section id="product" className="bg-surface py-20 sm:py-28">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <div className="max-w-2xl">
              <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
                Product pillars
              </h2>
              <p className="mt-4 text-lg leading-relaxed text-slate-600">
                Everything here is aimed at the same outcome: fewer surprises for learners, instructors, and
                the teams who support them.
              </p>
            </div>
            <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ title, body, icon: Icon }) => (
                <article key={title} className="feature-card">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                    <Icon className="h-5 w-5" aria-hidden />
                  </div>
                  <h3 className="mt-5 text-base font-semibold text-slate-900">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">{body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Institutions */}
        <section id="institutions" className="border-y border-slate-200 py-20 sm:py-28">
          <div className="mx-auto grid max-w-6xl gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:items-center lg:gap-20 lg:px-8">
            <div>
              <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
                For districts, campuses, and programs that outgrow spreadsheets
              </h2>
              <p className="mt-5 text-lg leading-relaxed text-slate-600">
                Whether you are launching a new online program or standardizing delivery across schools,
                Lextures focuses on the workflows that break first at scale: enrollment drift, duplicate
                content, inconsistent accommodations, and grading that cannot be audited.
              </p>
              <ul className="mt-8 space-y-3">
                {[
                  'Role-aware navigation so admins, instructors, and learners each get a sane default.',
                  'Content and media pipelines that respect accessibility expectations from day one.',
                  'Integration posture that plays nicely with SIS, SSO, and classroom toolchains.',
                ].map((line) => (
                  <li key={line} className="flex gap-3 text-slate-700">
                    <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border border-slate-200 bg-surface-2 p-8">
              <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600">
                Design principle
              </p>
              <p className="mt-4 text-xl font-medium leading-snug text-slate-900">
                If a registrar would wince at the data model, it does not ship—operational honesty beats
                feature checklists.
              </p>
              <p className="mt-5 text-sm leading-relaxed text-slate-500">
                Lextures is under active development; the public demo is the fastest way to see current
                capabilities and UX direction.
              </p>
            </div>
          </div>
        </section>

        {/* Integrations */}
        <section id="integrations" className="bg-surface py-20 sm:py-28">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <div className="max-w-2xl">
              <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
                Plays well with institutional identity
              </h2>
              <p className="mt-4 text-lg text-slate-600">
                Standards and protocols matter when your next audit is always one calendar quarter away.
                The roadmap emphasizes boring, testable interoperability over proprietary magic.
              </p>
            </div>
            <dl className="mt-12 grid gap-5 sm:grid-cols-2">
              {[
                { term: 'LTI & launches', desc: 'Deep links into tools learners already know—without cloning accounts by hand.' },
                { term: 'Roster realities', desc: 'Class sections, co-teachers, and enrollment churn modeled explicitly—not as an afterthought.' },
                { term: 'Auth that fits', desc: 'Password, magic link, and enterprise SSO patterns so security teams can say yes.' },
                { term: 'Exports you can defend', desc: 'Grades and evidence trails structured for review, accreditation, and appeals.' },
              ].map((row) => (
                <div key={row.term} className="feature-card">
                  <dt className="text-sm font-semibold text-slate-900">{row.term}</dt>
                  <dd className="mt-2 text-sm leading-relaxed text-slate-600">{row.desc}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* CTA */}
        <section className="border-t border-slate-200 py-20 sm:py-28">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <div className="rounded-2xl bg-indigo-600 px-8 py-14 text-center sm:px-14">
              <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
                See Lextures in action
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-lg text-indigo-100">
                Walk the learner and instructor paths on the hosted demo, then decide whether the stack
                matches your institution&apos;s risk profile.
              </p>
              <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <a
                  href={LINKS.demo}
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-white px-6 py-3 text-sm font-semibold text-indigo-700 transition-colors hover:bg-indigo-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                >
                  Go to demo.lextures.com
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </a>
                <a
                  href={LINKS.github}
                  className="inline-flex items-center justify-center gap-2 rounded-md border border-indigo-400 px-6 py-3 text-sm font-semibold text-white transition-colors hover:border-indigo-200 hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                >
                  Study the source
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-10">
        <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 sm:flex-row sm:items-start sm:justify-between sm:px-6 lg:px-8">
          <div>
            <div className="flex items-center gap-2.5">
              <LogoMark className="h-8 w-8" />
              <span className="text-base font-semibold text-slate-900">Lextures</span>
            </div>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-slate-500">
              Marketing site for the Lextures learning platform. Product development happens in the open on
              GitHub.
            </p>
            <p className="mt-4 text-sm text-slate-400">© {new Date().getFullYear()} Lextures contributors</p>
          </div>
          <div className="flex flex-wrap gap-x-10 gap-y-3 text-sm font-medium text-slate-500">
            <a href={LINKS.demo} className="no-underline hover:text-slate-900 transition-colors">
              Live demo
            </a>
            <a href={LINKS.github} className="no-underline hover:text-slate-900 transition-colors">
              GitHub
            </a>
            <a href="#product" className="no-underline hover:text-slate-900 transition-colors">
              Product
            </a>
            <a href="#institutions" className="no-underline hover:text-slate-900 transition-colors">
              Institutions
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}
