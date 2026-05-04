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
      <rect width="32" height="32" rx="8" fill="currentColor" className="text-slate-900" />
      <path
        d="M9 23V9h5.2c2.9 0 5.1 1.6 5.1 4.2 0 2.5-2.2 4.1-5.1 4.1H12.5V23H9Zm3.5-8.2h1.4c1.4 0 2.3-.7 2.3-1.8 0-1.2-.9-1.9-2.3-1.9h-1.4v3.7Z"
        fill="#38bdf8"
      />
    </svg>
  )
}

export default function App() {
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    if (menuOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [menuOpen])

  const closeMenu = () => setMenuOpen(false)

  const btnPrimary =
    'inline-flex items-center justify-center gap-2 rounded-full bg-sky-400 px-6 py-3 text-sm font-bold text-slate-950 shadow-[0_0_24px_-4px_rgba(56,189,248,0.5)] transition duration-200 hover:scale-[1.02] hover:bg-sky-300 hover:shadow-[0_0_32px_-2px_rgba(56,189,248,0.55)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400'

  const btnOutline =
    'inline-flex items-center justify-center gap-2 rounded-full border border-sky-400/45 bg-transparent px-6 py-3 text-sm font-bold text-sky-100 transition duration-200 hover:scale-[1.02] hover:border-sky-300 hover:bg-sky-400/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400'

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-bg-deep text-slate-300">
      <div
        className="pointer-events-none fixed inset-0 bg-noise opacity-90"
        aria-hidden
      />
      <div
        className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(56,189,248,0.15),transparent)]"
        aria-hidden
      />

      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-sky-400/20 focus:px-4 focus:py-2 focus:text-sm focus:text-white"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-50 border-b border-white/[0.06] bg-slate-950/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <a href="#" className="flex items-center gap-2.5 font-semibold tracking-tight text-white no-underline">
            <span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg ring-1 ring-white/10">
              <LogoMark className="h-9 w-9" />
            </span>
            <span className="text-lg">Lextures</span>
          </a>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
            {NAV.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-400 no-underline transition hover:bg-white/[0.04] hover:text-white"
              >
                {item.label}
              </a>
            ))}
          </nav>

          <div className="hidden items-center gap-3 md:flex">
            <a href={LINKS.github} className={btnOutline + ' !px-5 !py-2.5 text-xs sm:text-sm'}>
              Source
            </a>
            <a href={LINKS.demo} className={btnPrimary + ' !px-5 !py-2.5 text-xs sm:text-sm'}>
              Try the demo
            </a>
          </div>

          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-white transition hover:border-sky-400/30 hover:bg-white/[0.06] md:hidden"
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </header>

      {menuOpen ? (
        <div
          className="fixed inset-0 z-[60] flex flex-col bg-slate-950 md:hidden"
          id="mobile-nav"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
        >
          <div className="flex h-16 items-center justify-between border-b border-white/[0.06] px-4">
            <span className="text-sm font-semibold text-white">Menu</span>
            <button
              type="button"
              onClick={closeMenu}
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 text-white hover:bg-white/[0.06]"
              aria-label="Close menu"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <nav className="flex flex-1 flex-col gap-1 p-4" aria-label="Mobile primary">
            {NAV.map((item) => (
              <a
                key={item.href}
                href={item.href}
                onClick={closeMenu}
                className="rounded-xl px-4 py-4 text-lg font-medium text-slate-200 no-underline transition hover:bg-white/[0.04]"
              >
                {item.label}
              </a>
            ))}
          </nav>
          <div className="border-t border-white/[0.06] p-4 pb-8">
            <a href={LINKS.demo} onClick={closeMenu} className={btnPrimary + ' w-full'}>
              Try the demo
            </a>
            <a href={LINKS.github} onClick={closeMenu} className={'mt-3 ' + btnOutline + ' w-full'}>
              View on GitHub
            </a>
          </div>
        </div>
      ) : null}

      <main id="main" className="relative">
        <section className="relative overflow-hidden pb-20 pt-16 sm:pb-28 sm:pt-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <p className="text-sm font-medium uppercase tracking-widest text-sky-400/90">
              Learning management
            </p>
            <h1 className="mt-6 max-w-3xl font-display text-4xl font-normal italic leading-[1.12] tracking-tight text-white sm:text-5xl lg:text-[3.25rem]">
              Calm software for{' '}
              <span className="not-italic text-gradient">courses, cohorts, and credentials</span>
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-slate-400 sm:text-xl">
              Lextures is an LMS built for institutions that cannot afford toy-grade reliability—where
              roster truth, accessible content, and defensible grading matter as much as the syllabus.
            </p>
            <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <a href={LINKS.demo} className={btnPrimary}>
                Open the live demo
                <ArrowRight className="h-4 w-4 opacity-90" aria-hidden />
              </a>
              <a href={LINKS.github} className={btnOutline}>
                Browse the repository
              </a>
            </div>
            <p className="mt-10 text-sm text-slate-500">
              Prefer to self-host or extend? The application stack is MIT-licensed—bring your own Postgres
              and ship on your timeline.
            </p>
          </div>
        </section>

        <section id="product" className="border-y border-white/[0.06] bg-bg-elevated/40 py-20 sm:py-28">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <div className="max-w-2xl">
              <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">Product pillars</h2>
              <p className="mt-4 text-lg leading-relaxed text-slate-400">
                Everything here is aimed at the same outcome: fewer surprises for learners, instructors, and
                the teams who support them.
              </p>
            </div>
            <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ title, body, icon: Icon }) => (
                <article
                  key={title}
                  className="glass-panel group rounded-2xl p-6 transition duration-200 hover:-translate-y-0.5 hover:border-sky-400/25 hover:shadow-[0_20px_50px_-28px_rgba(56,189,248,0.2)] sm:p-7"
                >
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-400/10 text-sky-300 ring-1 ring-sky-400/20">
                    <Icon className="h-5 w-5" aria-hidden />
                  </div>
                  <h3 className="mt-5 text-lg font-bold text-white">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-400 sm:text-[0.9375rem]">{body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="institutions" className="py-20 sm:py-28">
          <div className="mx-auto grid max-w-6xl gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:items-center lg:gap-16 lg:px-8">
            <div>
              <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
                For districts, campuses, and programs that outgrow spreadsheets
              </h2>
              <p className="mt-5 text-lg leading-relaxed text-slate-400">
                Whether you are launching a new online program or standardizing delivery across schools,
                Lextures focuses on the workflows that break first at scale: enrollment drift, duplicate
                content, inconsistent accommodations, and grading that cannot be audited.
              </p>
              <ul className="mt-8 space-y-3 text-slate-300">
                {[
                  'Role-aware navigation so admins, instructors, and learners each get a sane default.',
                  'Content and media pipelines that respect accessibility expectations from day one.',
                  'Integration posture that plays nicely with SIS, SSO, and classroom toolchains.',
                ].map((line) => (
                  <li key={line} className="flex gap-3">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="glass-panel relative overflow-hidden rounded-2xl p-8">
              <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-indigo-500/20 blur-3xl" />
              <div className="absolute -bottom-12 -left-12 h-40 w-40 rounded-full bg-sky-500/15 blur-3xl" />
              <p className="relative text-sm font-semibold uppercase tracking-wider text-sky-300/95">
                Design principle
              </p>
              <p className="relative mt-4 text-xl font-medium leading-snug text-white">
                If a registrar would wince at the data model, it does not ship—operational honesty beats
                feature checklists.
              </p>
              <p className="relative mt-5 text-sm leading-relaxed text-slate-500">
                Lextures is under active development; the public demo is the fastest way to see current
                capabilities and UX direction.
              </p>
            </div>
          </div>
        </section>

        <section id="integrations" className="border-t border-white/[0.06] bg-bg-elevated/30 py-20 sm:py-28">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <div className="max-w-2xl">
              <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
                Plays well with institutional identity
              </h2>
              <p className="mt-4 text-lg text-slate-400">
                Standards and protocols matter when your next audit is always one calendar quarter away.
                The roadmap emphasizes boring, testable interoperability over proprietary magic.
              </p>
            </div>
            <dl className="mt-12 grid gap-6 sm:grid-cols-2">
              {[
                { term: 'LTI & launches', desc: 'Deep links into tools learners already know—without cloning accounts by hand.' },
                { term: 'Roster realities', desc: 'Class sections, co-teachers, and enrollment churn modeled explicitly—not as an afterthought.' },
                { term: 'Auth that fits', desc: 'Password, magic link, and enterprise SSO patterns so security teams can say yes.' },
                { term: 'Exports you can defend', desc: 'Grades and evidence trails structured for review, accreditation, and appeals.' },
              ].map((row) => (
                <div key={row.term} className="glass-panel rounded-xl p-5">
                  <dt className="font-semibold text-white">{row.term}</dt>
                  <dd className="mt-2 text-sm leading-relaxed text-slate-400">{row.desc}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="pb-24 pt-4">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <div className="relative overflow-hidden rounded-3xl border border-sky-400/20 bg-gradient-to-br from-sky-500/10 via-transparent to-indigo-600/15 px-8 py-12 text-center sm:px-14 sm:py-16">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(56,189,248,0.12),transparent_55%)]" />
              <h2 className="relative text-3xl font-bold tracking-tight text-white sm:text-4xl">
                See Lextures in action
              </h2>
              <p className="relative mx-auto mt-4 max-w-xl text-lg text-slate-300">
                Walk the learner and instructor paths on the hosted demo, then decide whether the stack
                matches your institution&apos;s risk profile.
              </p>
              <div className="relative mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <a href={LINKS.demo} className={btnPrimary}>
                  Go to demo.lextures.com
                  <ArrowRight className="h-4 w-4 opacity-90" aria-hidden />
                </a>
                <a href={LINKS.github} className={btnOutline}>
                  Study the source
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/[0.06] bg-slate-950 py-10">
        <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 sm:flex-row sm:items-start sm:justify-between sm:px-6 lg:px-8">
          <div>
            <div className="flex items-center gap-2 text-white">
              <LogoMark className="h-8 w-8" />
              <span className="text-base font-semibold">Lextures</span>
            </div>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-slate-500">
              Marketing site for the Lextures learning platform. Product development happens in the open on
              GitHub.
            </p>
            <p className="mt-4 text-sm text-slate-600">© {new Date().getFullYear()} Lextures contributors</p>
          </div>
          <div className="flex flex-wrap gap-x-10 gap-y-3 text-sm font-medium text-slate-400">
            <a href={LINKS.demo} className="no-underline hover:text-white">
              Live demo
            </a>
            <a href={LINKS.github} className="no-underline hover:text-white">
              GitHub
            </a>
            <a href="#product" className="no-underline hover:text-white">
              Product
            </a>
            <a href="#institutions" className="no-underline hover:text-white">
              Institutions
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}
