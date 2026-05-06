import {
  ArrowRight,
  BarChart3,
  BookOpen,
  BrainCircuit,
  Code2,
  GraduationCap,
  Menu,
  RefreshCw,
  ShieldCheck,
  Unplug,
  X,
  Zap,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { HeroCanvas } from './HeroCanvas'

const LINKS = {
  demo: 'https://demo.lextures.com/',
  github: 'https://github.com/StudyDrift/lextures',
} as const

const NAV = [
  { label: 'Features', href: '#features' },
  { label: 'Adaptive AI', href: '#ai' },
  { label: 'Institutions', href: '#institutions' },
  { label: 'Integrations', href: '#integrations' },
] as const

const FEATURES = [
  {
    title: 'Adaptive quiz delivery',
    body: 'Quizzes adjust difficulty in real time using Item Response Theory. Every learner gets the right questions at the right moment—not a one-size-fits-all test.',
    icon: BrainCircuit,
  },
  {
    title: 'AI-generated content',
    body: 'Generate quiz questions from learning objectives, build rubrics from assignment descriptions, and produce progressive hints that guide without giving answers.',
    icon: Zap,
  },
  {
    title: '14+ question types',
    body: 'Multiple choice, essay, live code execution, image hotspots, matching, ordering, formula, and audio/video responses—built for every subject.',
    icon: BookOpen,
  },
  {
    title: 'Standards-based gradebook',
    body: 'Map assignments to NGSS, CCSS, or your own standards. Track mastery by objective—not just points. Every grading change is logged with who, what, and why.',
    icon: BarChart3,
  },
  {
    title: 'Canvas, Moodle & Blackboard-ready',
    body: 'LTI 1.3 provider: run Lextures inside any LMS your institution already uses. Import courses and question banks from Canvas with AI-assisted migration.',
    icon: Unplug,
  },
  {
    title: 'Enterprise identity & provisioning',
    body: 'SAML 2.0, OIDC, Clever, and ClassLink SSO. OneRoster 1.2 CSV and SCIM 2.0 HTTP for bulk roster sync. TOTP and WebAuthn MFA for every account.',
    icon: ShieldCheck,
  },
] as const

const AI_CAPABILITIES = [
  {
    title: 'Item Response Theory engine',
    body: "Questions are calibrated using IRT 2PL/3PL models. The system estimates each learner's mastery level in real time and routes them to the content they actually need next—not what's next in the syllabus.",
    icon: BrainCircuit,
  },
  {
    title: 'Misconception detection',
    body: 'AI analyzes incorrect responses across the class and surfaces the most common errors to instructors—so they can address patterns in the next session instead of marking them wrong and moving on.',
    icon: GraduationCap,
  },
  {
    title: 'Spaced repetition scheduler',
    body: 'The SRS engine schedules review material at scientifically optimal intervals. Knowledge sticks between sessions instead of fading before the final exam.',
    icon: RefreshCw,
  },
] as const

const INTEGRATIONS = [
  {
    term: 'LTI 1.3 provider & consumer',
    desc: 'Launch Lextures inside Canvas, Blackboard, or Moodle. Roster sync via NRPS, grade passback via AGS, and deep linking for publisher content—all spec-compliant.',
  },
  {
    term: 'Canvas import',
    desc: 'Move courses, question banks, and grades from Canvas using WebSocket-based import with AI-assisted migration. QTI 2.1/3.0 question bank imports from any major LMS.',
  },
  {
    term: 'SSO & roster provisioning',
    desc: 'SAML 2.0, OIDC, Clever, and ClassLink for identity. OneRoster 1.2 CSV and SCIM 2.0 HTTP for roster sync. Auto-provision users on first login.',
  },
  {
    term: 'Defensible exports',
    desc: 'Grade exports structured for accreditation reviews and appeals. iCalendar feeds for due dates. QTI exports for question bank portability.',
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
      <rect width="32" height="32" rx="8" fill="var(--color-accent)" />
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
    <div className="relative min-h-screen overflow-x-hidden bg-stone-50 text-slate-700">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:text-white"
      >
        Skip to content
      </a>

      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-stone-200/80 bg-stone-50/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <a href="#" className="flex items-center gap-2.5 no-underline">
            <LogoMark className="h-8 w-8 shrink-0" />
            <span className="text-base font-semibold tracking-tight text-stone-900">Lextures</span>
          </a>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
            {NAV.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="rounded-lg px-3 py-2 text-sm font-medium text-stone-600 no-underline transition-colors hover:bg-stone-200/60 hover:text-stone-900"
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
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-stone-200 text-stone-600 transition hover:bg-stone-200/50 md:hidden"
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
          className="fixed inset-0 z-[60] flex flex-col bg-stone-50 md:hidden"
          id="mobile-nav"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
        >
          <div className="flex h-16 items-center justify-between border-b border-stone-200 px-4">
            <div className="flex items-center gap-2.5">
              <LogoMark className="h-8 w-8" />
              <span className="text-base font-semibold text-stone-900">Lextures</span>
            </div>
            <button
              type="button"
              onClick={closeMenu}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-200/50"
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
                className="rounded-lg px-4 py-3.5 text-base font-medium text-stone-800 no-underline transition hover:bg-stone-200/50"
              >
                {item.label}
              </a>
            ))}
          </nav>
          <div className="flex flex-col gap-3 border-t border-stone-200 p-4 pb-8">
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
        <section className="relative overflow-hidden border-b border-stone-200/90 bg-white py-20 sm:py-28 lg:py-32">
          <HeroCanvas />
          {/* Fade keeps the canvas visible but never competes with copy */}
          <div
            className="pointer-events-none absolute inset-0 bg-gradient-to-r from-white via-white/95 to-transparent"
            aria-hidden
          />
          <div className="relative z-10 mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-stone-500">
              Open-source learning management
            </p>
            <h1 className="font-display mt-6 max-w-2xl text-[2.15rem] font-normal leading-[1.12] tracking-[-0.02em] text-stone-900 sm:text-5xl lg:text-[3.05rem]">
              The LMS that{' '}
              <span className="text-accent">adapts as learners move</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-stone-600 sm:text-xl">
              Adaptive quizzes, instructor workflows, and integrations that fit schools and programs
              running at real scale—not a slide deck with a gradebook attached.
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
            <p className="mt-8 text-sm text-stone-400">
              MIT license · Self-hosted Postgres · LTI 1.3
            </p>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="bg-surface py-20 sm:py-28">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <div className="max-w-2xl">
              <h2 className="text-3xl font-semibold tracking-tight text-stone-900 sm:text-4xl">
                Built for courses, grading, and the messy middle
              </h2>
              <p className="mt-4 text-lg leading-relaxed text-stone-600">
                Course management, assessments, gradebook, and integrations—without treating
                adaptation like a marketing bolt-on.
              </p>
            </div>
            <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ title, body, icon: Icon }) => (
                <article key={title} className="feature-card">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-muted/70 text-accent">
                    <Icon className="h-5 w-5" aria-hidden />
                  </div>
                  <h3 className="mt-5 text-base font-semibold text-stone-900">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-stone-600">{body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Adaptive AI */}
        <section id="ai" className="border-y border-stone-200/90 bg-white py-20 sm:py-28">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <div className="max-w-2xl">
              <p className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-stone-500">
                Delivery & outcomes
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-stone-900 sm:text-4xl">
                Adaptive mechanics, not buzzwords
              </h2>
              <p className="mt-4 text-lg leading-relaxed text-stone-600">
                Routing, misconceptions, and review scheduling sit next to grading and content—because
                that is where they actually affect outcomes.
              </p>
            </div>
            <div className="mt-12 grid gap-8 lg:grid-cols-3">
              {AI_CAPABILITIES.map(({ title, body, icon: Icon }) => (
                <div key={title} className="flex flex-col gap-4 rounded-xl border border-stone-200/90 bg-stone-50/50 p-6">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-stone-900 text-white shadow-sm">
                    <Icon className="h-5 w-5" aria-hidden />
                  </div>
                  <h3 className="text-lg font-semibold text-stone-900">{title}</h3>
                  <p className="text-sm leading-relaxed text-stone-600">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Institutions */}
        <section id="institutions" className="bg-surface py-20 sm:py-28">
          <div className="mx-auto grid max-w-6xl gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:items-center lg:gap-20 lg:px-8">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight text-stone-900 sm:text-4xl">
                Built around how institutions actually operate
              </h2>
              <p className="mt-5 text-lg leading-relaxed text-stone-600">
                From K-12 districts to university programs, Lextures is modeled on the workflows
                that break first at scale: enrollment drift, inconsistent accommodations, grading
                that can't be audited, and content no one can keep synchronized.
              </p>
              <ul className="mt-8 space-y-3">
                {[
                  'Course blueprints let coordinators maintain master templates and push updates to every child section at once.',
                  'Accommodations are managed at the platform level—extra time and reduced distraction mode apply automatically, without per-assignment workarounds.',
                  'Every grading action is logged: who changed what, when, and why—so appeals and accreditation reviews have a real paper trail.',
                ].map((line) => (
                  <li key={line} className="flex gap-3 text-stone-700">
                    <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border border-stone-200/90 bg-surface-2 p-8 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]">
              <p className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-stone-500">
                Design principle
              </p>
              <p className="mt-4 text-xl font-medium leading-snug text-stone-900">
                If a registrar would wince at the data model, it doesn't ship—operational honesty
                beats feature checklists.
              </p>
              <p className="mt-5 text-sm leading-relaxed text-stone-500">
                Lextures is under active development. The public demo is the fastest way to see
                current capabilities and the direction the product is heading.
              </p>
              <a href={LINKS.demo} className="btn-primary mt-6 inline-flex gap-2">
                See it live
                <ArrowRight className="h-4 w-4" aria-hidden />
              </a>
            </div>
          </div>
        </section>

        {/* Integrations */}
        <section id="integrations" className="border-t border-stone-200/90 bg-white py-20 sm:py-28">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <div className="max-w-2xl">
              <h2 className="text-3xl font-semibold tracking-tight text-stone-900 sm:text-4xl">
                Works inside the stack you already have
              </h2>
              <p className="mt-4 text-lg text-stone-600">
                No rip-and-replace. Lextures is designed to integrate with Canvas, Blackboard,
                Moodle, and your district SIS—or stand alone as your primary LMS.
              </p>
            </div>
            <dl className="mt-12 grid gap-5 sm:grid-cols-2">
              {INTEGRATIONS.map((row) => (
                <div key={row.term} className="feature-card">
                  <dt className="text-sm font-semibold text-stone-900">{row.term}</dt>
                  <dd className="mt-2 text-sm leading-relaxed text-stone-600">{row.desc}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-stone-400">
              {['LTI 1.3', 'SAML 2.0', 'OIDC', 'OneRoster 1.2', 'SCIM 2.0', 'Clever', 'ClassLink', 'QTI 2.1/3.0', 'Canvas import', 'iCalendar'].map((tag) => (
                <span key={tag} className="font-medium text-stone-500">{tag}</span>
              ))}
            </div>
          </div>
        </section>

        {/* Code section */}
        <section className="border-y border-stone-200/90 bg-surface py-16 sm:py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-8 lg:flex-row lg:items-center lg:gap-16">
              <div className="lg:max-w-md">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-muted/70 text-accent">
                  <Code2 className="h-5 w-5" aria-hidden />
                </div>
                <h2 className="mt-5 text-2xl font-semibold tracking-tight text-stone-900 sm:text-3xl">
                  Open source, MIT-licensed
                </h2>
                <p className="mt-4 leading-relaxed text-stone-600">
                  The full application stack—Go backend, React frontend, database migrations—is
                  public on GitHub. Deploy on your own infrastructure, fork it, or contribute.
                  No vendor lock-in, no usage fees.
                </p>
                <div className="mt-6 flex gap-3">
                  <a href={LINKS.github} className="btn-primary gap-2">
                    View on GitHub
                    <ArrowRight className="h-4 w-4" aria-hidden />
                  </a>
                </div>
              </div>
              <div className="flex-1 rounded-xl border border-stone-800 bg-stone-950 p-6 font-mono text-sm leading-relaxed shadow-sm">
                <p className="text-stone-500"># Get started in minutes</p>
                <p className="mt-3">
                  <span className="text-teal-400">git clone</span>{' '}
                  <span className="text-stone-300">https://github.com/StudyDrift/lextures</span>
                </p>
                <p className="mt-1">
                  <span className="text-teal-400">cd</span>{' '}
                  <span className="text-stone-300">lextures</span>
                </p>
                <p className="mt-3 text-stone-500"># Start with Docker Compose</p>
                <p className="mt-1">
                  <span className="text-teal-400">docker compose up</span>{' '}
                  <span className="text-stone-500">-d</span>
                </p>
                <p className="mt-3 text-stone-500"># Or run locally with your own Postgres</p>
                <p className="mt-1">
                  <span className="text-teal-400">make</span>{' '}
                  <span className="text-stone-300">dev</span>
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-20 sm:py-28">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <div className="rounded-2xl border border-stone-200/90 bg-white px-8 py-14 text-center shadow-[0_12px_40px_-24px_rgba(28,25,23,0.35)] sm:px-14">
              <h2 className="text-3xl font-semibold tracking-tight text-stone-900 sm:text-4xl">
                Try the product on the hosted demo
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-lg leading-relaxed text-stone-600">
                Walk learner and instructor flows—quizzes, gradebook, imports—then decide if the stack
                matches your institution.
              </p>
              <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <a href={LINKS.demo} className="btn-primary gap-2 px-6 py-3">
                  Open demo.lextures.com
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </a>
                <a href={LINKS.github} className="btn-secondary px-6 py-3">
                  Study the source
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-stone-200/90 bg-white py-12">
        <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 sm:flex-row sm:items-start sm:justify-between sm:px-6 lg:px-8">
          <div>
            <div className="flex items-center gap-2.5">
              <LogoMark className="h-8 w-8" />
              <span className="text-base font-semibold text-stone-900">Lextures</span>
            </div>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-stone-500">
              Open-source LMS for courses, assessments, and institutional workflows. Developed in public
              on GitHub.
            </p>
            <p className="mt-4 text-sm text-stone-400">© {new Date().getFullYear()} Lextures contributors</p>
          </div>
          <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm font-medium text-stone-500">
            <a href={LINKS.demo} className="no-underline transition-colors hover:text-stone-900">
              Live demo
            </a>
            <a href={LINKS.github} className="no-underline transition-colors hover:text-stone-900">
              GitHub
            </a>
            <a href="#features" className="no-underline transition-colors hover:text-stone-900">
              Features
            </a>
            <a href="#ai" className="no-underline transition-colors hover:text-stone-900">
              Adaptive AI
            </a>
            <a href="#institutions" className="no-underline transition-colors hover:text-stone-900">
              Institutions
            </a>
            <a href="#integrations" className="no-underline transition-colors hover:text-stone-900">
              Integrations
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}
