import {
  ArrowRight,
  BookOpen,
  Bot,
  Boxes,
  CalendarDays,
  Github,
  GraduationCap,
  Inbox,
  Layers,
  LockOpen,
  MessageSquareQuote,
  MousePointer2,
  Palette,
  Sparkles,
  Terminal,
  Zap,
} from 'lucide-react'
import { motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { HeroCanvas } from './components/HeroCanvas'
import { FadeUp, MotionSection } from './components/Motion'

const LINKS = {
  github: 'https://github.com/StudyDrift/lextures',
  demo: 'https://demo.lextures.com/',
  docs: 'https://github.com/StudyDrift/lextures#readme',
} as const

const NAV = [
  { label: 'Features', href: '#features' },
  { label: 'Demo', href: '#demo' },
  { label: 'Docs', href: LINKS.docs },
  { label: 'GitHub', href: LINKS.github },
]

function ThemeToggle() {
  const [mode, setMode] = useState<'dark' | 'light'>('dark')

  useEffect(() => {
    const stored = localStorage.getItem('lextures-theme') as 'dark' | 'light' | null
    const initial = stored === 'light' ? 'light' : 'dark'
    setMode(initial)
    document.documentElement.classList.toggle('light', initial === 'light')
  }, [])

  const toggle = () => {
    const next = mode === 'dark' ? 'light' : 'dark'
    setMode(next)
    localStorage.setItem('lextures-theme', next)
    document.documentElement.classList.toggle('light', next === 'light')
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="glass-panel relative inline-flex h-10 w-10 items-center justify-center rounded-xl text-sm font-medium text-slate-300 transition hover:border-cyan-400/40 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 light:text-slate-600 light:hover:text-slate-900"
      aria-label={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      <span className="sr-only">Toggle theme</span>
      {mode === 'dark' ? (
        <span className="text-lg" aria-hidden>
          ☀️
        </span>
      ) : (
        <span className="text-lg" aria-hidden>
          🌙
        </span>
      )}
    </button>
  )
}

function LogoMark({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      aria-hidden
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="32" height="32" rx="8" className="fill-slate-950 light:fill-white" />
      <path
        d="M8 22V10l6 8 6-8v12"
        className="stroke-cyan-400 light:stroke-cyan-600"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default function App() {
  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <a
        href="#main"
        className="focus:bg-cyan-400/20 sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:px-4 focus:py-2 focus:text-sm focus:text-white"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-50 border-b border-white/5 bg-bg-deep/75 backdrop-blur-xl light:border-slate-200/80 light:bg-white/80">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <a href="#" className="flex items-center gap-2.5 font-semibold tracking-tight text-white light:text-slate-900">
            <LogoMark className="h-9 w-9 shrink-0 shadow-lg shadow-cyan-500/10 ring-1 ring-white/10 light:shadow-slate-900/5 light:ring-slate-200" />
            <span className="text-lg">Lextures</span>
          </a>
          <nav
            className="-mx-1 flex max-w-[min(100vw-12rem,28rem)] items-center gap-0.5 overflow-x-auto px-1 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] md:max-w-none md:gap-1 md:overflow-visible md:pb-0 [&::-webkit-scrollbar]:hidden"
            aria-label="Primary"
          >
            {NAV.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="shrink-0 rounded-lg px-2.5 py-2 text-sm font-medium text-slate-400 transition hover:bg-white/5 hover:text-white md:px-3 light:text-slate-600 light:hover:bg-slate-100 light:hover:text-slate-900"
              >
                {item.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <a
              href={LINKS.demo}
              className="inline-flex shrink-0 items-center gap-1 rounded-xl bg-gradient-to-r from-cyan-400 to-sky-500 px-3 py-2 text-sm font-semibold text-slate-950 shadow-lg shadow-cyan-500/25 transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 sm:px-4"
            >
              <span className="hidden sm:inline">Get Started</span>
              <span className="sm:hidden">Start</span>
              <ArrowRight className="h-4 w-4" aria-hidden />
            </a>
          </div>
        </div>
      </header>

      <main id="main">
        {/* Hero */}
        <section className="relative overflow-hidden pb-24 pt-16 sm:pb-32 sm:pt-24 lg:pt-28">
          <HeroCanvas />
          <div className="relative mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              className="flex flex-wrap items-center gap-3"
            >
              <span className="glass-panel inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium text-cyan-200 light:text-cyan-800">
                <Sparkles className="h-3.5 w-3.5 text-cyan-400 light:text-cyan-600" aria-hidden />
                Open source · AGPL-3.0
              </span>
              <a
                href={LINKS.github}
                className="glass-panel inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium text-slate-300 transition hover:border-cyan-400/30 hover:text-white light:text-slate-600 light:hover:text-slate-900"
              >
                <Github className="h-3.5 w-3.5" aria-hidden />
                Star on GitHub
              </a>
            </motion.div>

            <motion.h1
              className="mt-8 max-w-4xl text-4xl font-semibold tracking-tight text-white sm:text-5xl lg:text-6xl lg:leading-[1.05] light:text-slate-900"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.65, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
            >
              The first truly{' '}
              <span className="text-gradient">adaptive learning</span> environment.
            </motion.h1>

            <motion.p
              className="mt-6 max-w-2xl text-lg leading-relaxed text-slate-400 sm:text-xl light:text-slate-600"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.18 }}
            >
              Get to the content, faster. Lextures pairs structured course operations—modules,
              calendar, gradebook, enrollments—with AI that drafts, adapts, and personalizes so you
              spend less time on tooling and more time teaching.
            </motion.p>

            <motion.div
              className="mt-10 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.28 }}
            >
              <a
                href={LINKS.demo}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 to-sky-500 px-6 py-3.5 text-base font-semibold text-slate-950 shadow-xl shadow-cyan-500/20 transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400"
              >
                Try the Demo
                <ArrowRight className="h-5 w-5" aria-hidden />
              </a>
              <a
                href={LINKS.github}
                className="glass-panel inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3.5 text-base font-semibold text-white transition hover:border-cyan-400/35 hover:bg-white/[0.06] light:text-slate-900 light:hover:bg-white"
              >
                <Github className="h-5 w-5" aria-hidden />
                Star on GitHub
              </a>
              <a
                href="#self-host"
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-cyan-400/40 bg-cyan-400/10 px-6 py-3.5 text-base font-semibold text-cyan-100 transition hover:bg-cyan-400/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 light:border-cyan-600/40 light:bg-cyan-500/10 light:text-cyan-900 light:hover:bg-cyan-500/15"
              >
                Self-Host Now
              </a>
            </motion.div>

            <motion.dl
              className="mt-14 grid gap-6 sm:grid-cols-3"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4, duration: 0.6 }}
            >
              {[
                { k: 'Deploy', v: 'Docker · PostgreSQL + MongoDB wired' },
                { k: 'Frontend', v: 'React 19 + Tailwind — fast & polished' },
                { k: 'Freedom', v: 'Full data ownership, no vendor lock-in' },
              ].map((row) => (
                <div key={row.k} className="glass-panel rounded-2xl p-5">
                  <dt className="text-xs font-semibold uppercase tracking-wider text-cyan-300/90 light:text-cyan-700">
                    {row.k}
                  </dt>
                  <dd className="mt-2 text-sm text-slate-300 light:text-slate-600">{row.v}</dd>
                </div>
              ))}
            </motion.dl>
          </div>
        </section>

        {/* Problem → Solution */}
        <MotionSection className="border-y border-white/5 bg-bg-elevated/40 py-20 light:border-slate-200/80 light:bg-white/40">
          <div className="mx-auto grid max-w-6xl gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:items-center lg:px-8">
            <FadeUp>
              <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl light:text-slate-900">
                Traditional LMS workflows weren&apos;t built for modern velocity.
              </h2>
              <p className="mt-4 text-slate-400 light:text-slate-600">
                Fragmented tools, brittle content pipelines, and rigid paths slow educators down.
                Learners bounce between tabs instead of staying in flow.
              </p>
            </FadeUp>
            <FadeUp delay={0.1}>
              <div className="glass-panel relative overflow-hidden rounded-3xl p-8">
                <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-cyan-500/20 blur-3xl" />
                <div className="relative">
                  <div className="flex items-center gap-2 text-cyan-300 light:text-cyan-700">
                    <Zap className="h-5 w-5" aria-hidden />
                    <span className="text-sm font-semibold uppercase tracking-wide">
                      The Lextures flow
                    </span>
                  </div>
                  <p className="mt-4 text-lg font-medium text-white light:text-slate-900">
                    One adaptive workspace: structure when you need it, AI when it helps, speed
                    everywhere else.
                  </p>
                  <ul className="mt-6 space-y-3 text-slate-300 light:text-slate-600">
                    <li className="flex gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" />
                      Ship courses with modular authoring and rich editing—without the busywork.
                    </li>
                    <li className="flex gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400" />
                      Generate quizzes and iterate content with guardrails you control.
                    </li>
                    <li className="flex gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" />
                      Personalize paths while keeping institutional-grade operations intact.
                    </li>
                  </ul>
                </div>
              </div>
            </FadeUp>
          </div>
        </MotionSection>

        {/* Features */}
        <MotionSection id="features" className="py-24 sm:py-28">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <FadeUp className="max-w-2xl">
              <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl light:text-slate-900">
                Everything you expect from an LMS—elevated by adaptive AI.
              </h2>
              <p className="mt-4 text-lg text-slate-400 light:text-slate-600">
                Purpose-built for educators and builders who refuse to compromise between polish and
                ownership.
              </p>
            </FadeUp>

            <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {[
                {
                  icon: Bot,
                  title: 'AI course & quiz generation',
                  body: 'Draft outlines, lessons, and assessments faster—then refine with full editorial control.',
                },
                {
                  icon: MousePointer2,
                  title: 'Adaptive learning paths',
                  body: 'Tune journeys to readiness and goals so learners progress with momentum, not friction.',
                },
                {
                  icon: Layers,
                  title: 'Rich course workspace',
                  body: 'Drag-and-drop modules and a TipTap-powered editor for structured, beautiful content.',
                },
                {
                  icon: CalendarDays,
                  title: 'Calendar & gradebook',
                  body: 'Operational clarity for cohorts: schedules, submissions, and outcomes in one place.',
                },
                {
                  icon: Inbox,
                  title: 'Inbox & communication',
                  body: 'Keep learners and instructors aligned without bolting on yet another chat stack.',
                },
                {
                  icon: Sparkles,
                  title: 'OpenRouter integration',
                  body: 'Optional model routing so teams can standardize providers without rewriting workflows.',
                },
                {
                  icon: LockOpen,
                  title: 'Self-hosted & sovereign',
                  body: 'Docker-ready deploys with PostgreSQL—and MongoDB wired for future platform depth.',
                },
              ].map((f) => (
                <FadeUp key={f.title}>
                  <article className="glass-panel group relative h-full rounded-2xl p-6 transition hover:border-cyan-400/25 hover:shadow-[0_0_0_1px_rgba(34,211,238,0.08)]">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-400/10 text-cyan-300 ring-1 ring-cyan-400/20 light:bg-cyan-500/15 light:text-cyan-700">
                      <f.icon className="h-5 w-5" aria-hidden />
                    </div>
                    <h3 className="mt-5 text-lg font-semibold text-white light:text-slate-900">
                      {f.title}
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-slate-400 light:text-slate-600">
                      {f.body}
                    </p>
                  </article>
                </FadeUp>
              ))}
            </div>
          </div>
        </MotionSection>

        {/* Demo teaser */}
        <MotionSection id="demo" className="pb-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <FadeUp className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl light:text-slate-900">
                  Mission control for courses—built for speed.
                </h2>
                <p className="mt-3 max-w-xl text-slate-400 light:text-slate-600">
                  The interface stays calm under complexity: enrollments, adaptive signals, and
                  authoring surface where they belong.
                </p>
              </div>
              <a
                href={LINKS.demo}
                className="inline-flex shrink-0 items-center gap-2 self-start rounded-xl border border-white/10 bg-white/5 px-5 py-2.5 text-sm font-semibold text-white transition hover:border-cyan-400/35 hover:bg-white/10 light:border-slate-200 light:bg-white light:text-slate-900 light:hover:border-cyan-500/40"
              >
                Open live demo
                <ArrowRight className="h-4 w-4" aria-hidden />
              </a>
            </FadeUp>

            <FadeUp delay={0.08} className="mt-10">
              <div className="glass-panel relative overflow-hidden rounded-3xl border-cyan-400/15 p-2 shadow-2xl shadow-cyan-500/5 ring-1 ring-white/10 light:shadow-slate-900/10">
                <div className="flex items-center gap-2 border-b border-white/5 px-4 py-3 light:border-slate-200/80">
                  <span className="h-2.5 w-2.5 rounded-full bg-red-400/80" />
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-400/80" />
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
                  <span className="ml-3 font-mono text-xs text-slate-500 light:text-slate-400">
                    demo.lextures.com
                  </span>
                </div>
                <div className="grid gap-0 lg:grid-cols-[240px_1fr]">
                  <div className="hidden border-r border-white/5 bg-slate-950/40 p-4 lg:block light:border-slate-200/80 light:bg-slate-50/80">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Workspace
                    </p>
                    <ul className="mt-4 space-y-2 text-sm text-slate-300 light:text-slate-600">
                      <li className="rounded-lg bg-cyan-400/10 px-3 py-2 text-cyan-100 light:bg-cyan-500/15 light:text-cyan-900">
                        Adaptive overview
                      </li>
                      <li className="rounded-lg px-3 py-2 hover:bg-white/5 light:hover:bg-slate-100">
                        Modules
                      </li>
                      <li className="rounded-lg px-3 py-2 hover:bg-white/5 light:hover:bg-slate-100">
                        Gradebook
                      </li>
                      <li className="rounded-lg px-3 py-2 hover:bg-white/5 light:hover:bg-slate-100">
                        Calendar
                      </li>
                    </ul>
                  </div>
                  <div className="relative min-h-[320px] bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6 sm:min-h-[380px] light:from-slate-100 light:via-white light:to-slate-50">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wider text-cyan-300/90 light:text-cyan-700">
                          Course dashboard
                        </p>
                        <p className="mt-1 text-xl font-semibold text-white light:text-slate-900">
                          Quantum Foundations
                        </p>
                      </div>
                      <span className="rounded-full bg-emerald-400/15 px-3 py-1 text-xs font-semibold text-emerald-300 ring-1 ring-emerald-400/25 light:text-emerald-800">
                        Live cohort
                      </span>
                    </div>
                    <div className="mt-8 grid gap-4 sm:grid-cols-3">
                      {[
                        { label: 'Engagement', value: '94%', tone: 'from-cyan-400 to-sky-500' },
                        { label: 'At-risk', value: '3 learners', tone: 'from-amber-400 to-orange-500' },
                        { label: 'AI assists', value: '128', tone: 'from-indigo-400 to-violet-500' },
                      ].map((card) => (
                        <div
                          key={card.label}
                          className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 light:border-slate-200 light:bg-white light:shadow-sm"
                        >
                          <p className="text-xs text-slate-400 light:text-slate-500">{card.label}</p>
                          <p
                            className={`mt-2 bg-gradient-to-r ${card.tone} bg-clip-text text-2xl font-semibold text-transparent`}
                          >
                            {card.value}
                          </p>
                        </div>
                      ))}
                    </div>
                    <div className="mt-6 rounded-2xl border border-dashed border-cyan-400/25 bg-cyan-400/[0.06] p-4 light:border-cyan-600/30 light:bg-cyan-500/10">
                      <p className="text-sm font-medium text-cyan-100 light:text-cyan-900">
                        Adaptive suggestion
                      </p>
                      <p className="mt-1 text-sm text-slate-300 light:text-slate-600">
                        Shorten the mid-module quiz for learners trending ahead—keep rigor, reduce
                        stall points.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </FadeUp>
          </div>
        </MotionSection>

        {/* Audiences */}
        <MotionSection className="border-y border-white/5 bg-bg-elevated/35 py-24 light:border-slate-200/80 light:bg-slate-50/80">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <FadeUp className="max-w-2xl">
              <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl light:text-slate-900">
                Built for the people who actually run learning programs.
              </h2>
            </FadeUp>
            <div className="mt-12 grid gap-6 lg:grid-cols-3">
              {[
                {
                  icon: GraduationCap,
                  title: 'For educators',
                  body: 'Spend energy on pedagogy—not patchwork integrations. Ship iterations weekly, not per semester.',
                },
                {
                  icon: BookOpen,
                  title: 'For institutions',
                  body: 'Operational backbone you can trust: enrollments, grading, calendars—and an AI layer teams can govern.',
                },
                {
                  icon: Terminal,
                  title: 'For developers',
                  body: 'Own the stack. Extend the Go API and React SPA, self-host with Docker, and keep data where it belongs.',
                },
              ].map((block) => (
                <FadeUp key={block.title}>
                  <div className="glass-panel h-full rounded-2xl p-7">
                    <block.icon className="h-8 w-8 text-cyan-300 light:text-cyan-700" aria-hidden />
                    <h3 className="mt-5 text-xl font-semibold text-white light:text-slate-900">
                      {block.title}
                    </h3>
                    <p className="mt-3 text-slate-400 light:text-slate-600">{block.body}</p>
                  </div>
                </FadeUp>
              ))}
            </div>
          </div>
        </MotionSection>

        {/* Tech stack */}
        <MotionSection className="py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <FadeUp className="max-w-2xl">
              <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl light:text-slate-900">
                Modern foundations. Battle-tested patterns.
              </h2>
              <p className="mt-4 text-slate-400 light:text-slate-600">
                A cohesive codebase designed for clarity—fast UX up front, dependable services
                behind the scenes.
              </p>
            </FadeUp>
            <FadeUp delay={0.06} className="mt-10 flex flex-wrap gap-3">
              {[
                'React 19',
                'Vite 8',
                'Tailwind CSS v4',
                'TypeScript',
                'Go API',
                'Chi',
                'PostgreSQL',
                'MongoDB',
                'Docker',
                'JWT auth',
              ].map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium text-slate-200 light:border-slate-200 light:bg-white light:text-slate-800"
                >
                  {tag}
                </span>
              ))}
            </FadeUp>
          </div>
        </MotionSection>

        {/* Testimonials */}
        <MotionSection className="pb-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <FadeUp className="flex items-center gap-3">
              <MessageSquareQuote className="h-8 w-8 text-cyan-400 light:text-cyan-600" aria-hidden />
              <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl light:text-slate-900">
                Community voices
              </h2>
            </FadeUp>
            <div className="mt-12 grid gap-6 lg:grid-cols-3">
              {[
                {
                  quote:
                    'We finally have an LMS that feels like product engineering—not a procurement compromise.',
                  name: 'Dr. Amara Chen',
                  role: 'Program Director, placeholder quote',
                },
                {
                  quote:
                    'The adaptive layer is the unlock: learners stay in flow while we keep institutional rigor.',
                  name: 'Jordan Ellis',
                  role: 'Instructional Designer, placeholder quote',
                },
                {
                  quote:
                    'Self-hosting with Docker gave us ownership without sacrificing a polished learner UX.',
                  name: 'Sam Rivera',
                  role: 'Platform Engineer, placeholder quote',
                },
              ].map((t) => (
                <FadeUp key={t.name}>
                  <blockquote className="glass-panel flex h-full flex-col rounded-2xl p-7">
                    <p className="text-lg leading-relaxed text-slate-200 light:text-slate-700">
                      “{t.quote}”
                    </p>
                    <footer className="mt-6 text-sm text-slate-400 light:text-slate-500">
                      <span className="font-semibold text-white light:text-slate-900">{t.name}</span>
                      <span className="block">{t.role}</span>
                    </footer>
                  </blockquote>
                </FadeUp>
              ))}
            </div>
            <FadeUp delay={0.1} className="mt-10 flex flex-wrap items-center gap-4">
              <div className="glass-panel inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm text-slate-300 light:text-slate-600">
                <Github className="h-4 w-4" aria-hidden />
                Watch releases & discussions on GitHub
              </div>
              <a
                href={LINKS.github}
                className="text-sm font-semibold text-cyan-300 underline-offset-4 hover:underline light:text-cyan-700"
              >
                Explore the repository →
              </a>
            </FadeUp>
          </div>
        </MotionSection>

        {/* Open source */}
        <MotionSection id="self-host" className="border-t border-white/5 bg-bg-elevated/45 py-24 light:border-slate-200/80 light:bg-white/60">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
              <FadeUp>
                <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/25 bg-cyan-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-cyan-200 light:border-cyan-600/30 light:bg-cyan-500/10 light:text-cyan-800">
                  <Boxes className="h-3.5 w-3.5" aria-hidden />
                  Open Source & Self-Host
                </div>
                <h2 className="mt-6 text-3xl font-semibold tracking-tight text-white sm:text-4xl light:text-slate-900">
                  AGPL-3.0 licensed. Your cloud, your rules.
                </h2>
                <p className="mt-4 text-lg text-slate-400 light:text-slate-600">
                  No surprise egress fees on your pedagogy. Deploy with Docker, bring your own AI
                  keys, and scale with confidence—without surrendering core workflows to a closed
                  roadmap.
                </p>
                <ul className="mt-8 space-y-4 text-slate-300 light:text-slate-600">
                  <li className="flex gap-3">
                    <Palette className="mt-0.5 h-5 w-5 shrink-0 text-cyan-400 light:text-cyan-600" />
                    Transparent codebase you can audit, fork, and extend.
                  </li>
                  <li className="flex gap-3">
                    <LockOpen className="mt-0.5 h-5 w-5 shrink-0 text-cyan-400 light:text-cyan-600" />
                    PostgreSQL today—MongoDB wired for platform evolution on your timeline.
                  </li>
                </ul>
              </FadeUp>
              <FadeUp delay={0.08}>
                <div className="glass-panel rounded-3xl p-6 font-mono text-sm leading-relaxed text-slate-200 light:text-slate-700">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>docker-compose.yml</span>
                    <span className="rounded bg-white/5 px-2 py-0.5 light:bg-slate-100">example</span>
                  </div>
                  <pre className="mt-4 overflow-x-auto text-[13px] text-cyan-100 light:text-cyan-900">
                    {`git clone https://github.com/StudyDrift/lextures.git
cd lextures
docker compose up -d postgres mongo
# configure server/.env → run API & web`}
                  </pre>
                  <p className="mt-4 text-xs text-slate-500">
                    See repository README for environment variables and production hardening notes.
                  </p>
                </div>
              </FadeUp>
            </div>
          </div>
        </MotionSection>

        {/* Final CTA */}
        <MotionSection className="pb-28 pt-10">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <FadeUp>
              <div className="relative overflow-hidden rounded-[2rem] border border-cyan-400/20 bg-gradient-to-br from-cyan-500/15 via-sky-500/10 to-indigo-500/10 p-10 text-center shadow-[0_0_80px_-20px_rgba(34,211,238,0.35)] light:border-cyan-600/25 light:from-cyan-500/10 light:shadow-slate-900/10 sm:p-14">
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.08),transparent)]" />
                <h2 className="relative text-3xl font-semibold tracking-tight text-white sm:text-4xl light:text-slate-900">
                  Start building better learning experiences today.
                </h2>
                <p className="relative mx-auto mt-4 max-w-2xl text-lg text-slate-200 light:text-slate-600">
                  Try the hosted demo, star the project, or self-host in minutes. The adaptive era of
                  learning infrastructure is open source.
                </p>
                <div className="relative mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row sm:flex-wrap">
                  <a
                    href={LINKS.demo}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-8 py-3.5 text-base font-semibold text-slate-950 shadow-lg transition hover:bg-slate-100 sm:w-auto"
                  >
                    Launch Demo
                  </a>
                  <a
                    href={LINKS.github}
                    className="glass-panel inline-flex w-full items-center justify-center gap-2 rounded-xl px-8 py-3.5 text-base font-semibold text-white light:text-slate-900 sm:w-auto"
                  >
                    <Github className="h-5 w-5" aria-hidden />
                    GitHub
                  </a>
                  <a
                    href={LINKS.docs}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/25 bg-transparent px-8 py-3.5 text-base font-semibold text-white transition hover:bg-white/10 light:border-slate-300 light:text-slate-900 light:hover:bg-slate-100 sm:w-auto"
                  >
                    Read the Docs
                  </a>
                </div>
              </div>
            </FadeUp>
          </div>
        </MotionSection>
      </main>

      <footer className="border-t border-white/5 py-10 light:border-slate-200/80">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <div className="flex items-center gap-2 text-sm text-slate-500 light:text-slate-500">
            <LogoMark className="h-8 w-8 opacity-90" />
            <span>© {new Date().getFullYear()} Lextures · AGPL-3.0</span>
          </div>
          <div className="flex flex-wrap gap-4 text-sm font-medium text-slate-400 light:text-slate-600">
            <a className="hover:text-white light:hover:text-slate-900" href={LINKS.demo}>
              Demo
            </a>
            <a className="hover:text-white light:hover:text-slate-900" href={LINKS.github}>
              GitHub
            </a>
            <a className="hover:text-white light:hover:text-slate-900" href={LINKS.docs}>
              Docs
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}
