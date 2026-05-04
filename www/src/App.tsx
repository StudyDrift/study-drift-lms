import {
  ArrowDown,
  ArrowRight,
  Github,
  Menu,
  Network,
  Sparkles,
  Workflow,
  X,
} from 'lucide-react'
import { motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { HeroCanvas } from './components/HeroCanvas'
import { FadeUp, MotionSection } from './components/Motion'

const LINKS = {
  github: 'https://github.com/openswarm/openswarm',
  downloadMac: 'https://github.com/openswarm/openswarm/releases/latest',
} as const

const NAV = [
  { label: 'Features', href: '#features' },
  { label: 'Workflows', href: '#workflows' },
  { label: 'Get running', href: '#get-running' },
  { label: 'GitHub', href: LINKS.github },
] as const

const PARTNERS = [
  'Gmail',
  'Slack',
  'Notion',
  'GitHub',
  'Figma',
  'Zapier',
  'Google Sheets',
  'Linear',
] as const

function SwarmLogoMark({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      aria-hidden
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="10" cy="12" r="3" className="fill-cyan-400" />
      <circle cx="22" cy="10" r="2.5" className="fill-cyan-300/80" />
      <circle cx="18" cy="20" r="2.5" className="fill-violet-400/90" />
      <circle cx="8" cy="22" r="2" className="fill-cyan-500/70" />
      <path
        d="M12.5 12.5L19.5 11M14 18l3.5-5M10 20l6-1"
        className="stroke-cyan-400/50"
        strokeWidth="1"
        strokeLinecap="round"
      />
    </svg>
  )
}

function CanvasPreview() {
  return (
    <div
      className="relative overflow-hidden rounded-xl border border-cyan-400/20 bg-gradient-to-br from-neutral-950 via-[#0d1117] to-violet-950/40 p-4 ring-1 ring-inset ring-white/[0.04]"
      aria-label="Preview of the 2D agent canvas"
    >
      <div className="mb-3 flex items-center justify-between text-[10px] font-medium uppercase tracking-wider text-neutral-500">
        <span>Canvas</span>
        <span className="rounded-full bg-cyan-400/15 px-2 py-0.5 text-cyan-300/90">Live</span>
      </div>
      <div className="relative aspect-[16/10] rounded-lg border border-white/5 bg-black/40">
        <svg className="absolute inset-0 h-full w-full" aria-hidden>
          <line x1="18%" y1="28%" x2="48%" y2="42%" stroke="rgba(34,211,238,0.35)" strokeWidth="1" />
          <line x1="48%" y1="42%" x2="72%" y2="32%" stroke="rgba(34,211,238,0.35)" strokeWidth="1" />
          <line x1="48%" y1="42%" x2="44%" y2="68%" stroke="rgba(167,139,250,0.35)" strokeWidth="1" />
        </svg>
        {[
          { l: '16%', t: '24%', c: 'bg-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.45)]' },
          { l: '44%', t: '38%', c: 'bg-cyan-300/90' },
          { l: '68%', t: '28%', c: 'bg-cyan-400/80' },
          { l: '40%', t: '62%', c: 'bg-violet-400/90 shadow-[0_0_10px_rgba(167,139,250,0.35)]' },
        ].map((n, i) => (
          <span
            key={i}
            className={`absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-1 ring-white/20 ${n.c}`}
            style={{ left: n.l, top: n.t }}
          />
        ))}
        <div className="absolute bottom-2 right-2 flex gap-1 rounded-md border border-white/10 bg-black/50 px-1.5 py-1 text-[9px] text-neutral-500">
          <span className="px-1">−</span>
          <span className="text-neutral-400">100%</span>
          <span className="px-1">+</span>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    document.documentElement.classList.remove('light')
  }, [])

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
    'inline-flex items-center justify-center gap-2 rounded-full bg-cyan-400 px-6 py-3 text-sm font-bold text-neutral-950 shadow-[0_0_24px_-4px_rgba(34,211,238,0.55)] transition duration-200 hover:scale-[1.03] hover:bg-cyan-300 hover:shadow-[0_0_32px_-2px_rgba(34,211,238,0.65)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400'

  const btnOutline =
    'inline-flex items-center justify-center gap-2 rounded-full border border-cyan-400/50 bg-transparent px-6 py-3 text-sm font-bold text-cyan-200 transition duration-200 hover:scale-[1.03] hover:border-cyan-300 hover:bg-cyan-400/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400'

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-bg-deep text-neutral-200">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-cyan-400/20 focus:px-4 focus:py-2 focus:text-sm focus:text-white"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-50 h-[4.25rem] border-b border-white/[0.06] bg-[#0a0a0a]/85 backdrop-blur-xl">
        <div className="mx-auto flex h-full max-w-[90rem] items-center justify-between gap-4 px-4 sm:px-6 lg:px-10">
          <a href="#" className="flex items-center gap-2.5 font-semibold tracking-tight text-white">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/[0.04] ring-1 ring-white/10">
              <SwarmLogoMark className="h-7 w-7" />
            </span>
            <span className="text-lg">OpenSwarm</span>
          </a>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
            {NAV.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="rounded-lg px-3 py-2 text-sm font-medium text-neutral-400 no-underline transition hover:bg-white/[0.04] hover:text-white"
              >
                {item.label}
              </a>
            ))}
          </nav>

          <div className="hidden items-center gap-3 md:flex">
            <a href={LINKS.github} className={btnOutline + ' !px-5 !py-2.5 text-xs sm:text-sm'}>
              <Github className="h-4 w-4" aria-hidden />
              Clone repo
            </a>
            <a href={LINKS.downloadMac} className={btnPrimary + ' !px-5 !py-2.5 text-xs sm:text-sm'}>
              Download for Mac
            </a>
          </div>

          <div className="flex items-center gap-2 md:hidden">
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-white transition hover:border-cyan-400/30 hover:bg-white/[0.06]"
              aria-expanded={menuOpen}
              aria-controls="mobile-nav"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      {menuOpen ? (
        <div
          className="fixed inset-0 z-[60] flex flex-col bg-[#0a0a0a] md:hidden"
          id="mobile-nav"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
        >
          <div className="flex h-[4.25rem] items-center justify-between border-b border-white/[0.06] px-4">
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
                className="rounded-xl px-4 py-4 text-lg font-medium text-neutral-200 no-underline transition hover:bg-white/[0.04]"
              >
                {item.label}
              </a>
            ))}
          </nav>
          <div className="border-t border-white/[0.06] p-4 pb-8">
            <a href={LINKS.downloadMac} onClick={closeMenu} className={btnPrimary + ' w-full'}>
              Download for Mac
            </a>
            <a
              href={LINKS.github}
              onClick={closeMenu}
              className={'mt-3 ' + btnOutline + ' w-full'}
            >
              <Github className="h-4 w-4" aria-hidden />
              Clone repo
            </a>
          </div>
        </div>
      ) : null}

      <main id="main">
        {/* Hero */}
        <section className="relative overflow-hidden pb-20 pt-14 sm:pb-28 sm:pt-20 lg:pt-24">
          <HeroCanvas />
          <div className="relative mx-auto max-w-[90rem] px-4 sm:px-6 lg:px-10">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              className="flex flex-wrap items-center gap-3"
            >
              <span className="inline-flex items-center gap-2 rounded-full border border-cyan-400/25 bg-cyan-400/10 px-3 py-1 text-xs font-medium tracking-wide text-cyan-200/95">
                <Sparkles className="h-3.5 w-3.5 text-cyan-400" aria-hidden />
                Free and open source · MIT
              </span>
            </motion.div>

            <motion.h1
              className="mt-8 max-w-4xl text-4xl font-bold tracking-tight text-white sm:text-5xl lg:text-[3.25rem] lg:leading-[1.08]"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}
            >
              <span className="text-neutral-500"># </span>
              OpenSwarm —{' '}
              <span className="text-gradient">Multi-agent orchestrator</span>
            </motion.h1>

            <motion.p
              className="mt-6 max-w-2xl text-lg leading-[1.7] text-neutral-400 sm:text-xl"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.14 }}
            >
              Your AI workforce on a 2D canvas: coordinate agents, watch status, and ship parallel
              workflows without losing the plot—built for developers who want clarity, not chaos.
            </motion.p>

            <motion.div
              className="mt-10 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.22 }}
            >
              <a href={LINKS.github} className={btnPrimary}>
                <Github className="h-5 w-5" aria-hidden />
                Clone the repo
              </a>
              <a href={LINKS.downloadMac} className={btnOutline}>
                Download for macOS
              </a>
            </motion.div>

            <motion.a
              href="#features"
              className="mt-16 inline-flex items-center gap-2 text-sm text-neutral-500 no-underline transition hover:text-cyan-300"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.45, duration: 0.5 }}
            >
              <ArrowDown className="h-4 w-4 text-cyan-500/80" aria-hidden />
              Scroll to explore
            </motion.a>
          </div>
        </section>

        <div className="mx-auto max-w-[90rem] border-t border-white/[0.06] px-4 sm:px-6 lg:px-10" />

        {/* Orchestrator intro */}
        <MotionSection className="py-20 sm:py-24">
          <div className="mx-auto grid max-w-[90rem] gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:items-center lg:gap-16 lg:px-10">
            <FadeUp>
              <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
                Orchestration that feels like mission control
              </h2>
              <p className="mt-5 text-lg leading-[1.75] text-neutral-400">
                OpenSwarm maps agents to a spatial canvas so you can reason about dependencies,
                parallelism, and health at a glance. No fireworks—just a calm, high-contrast
                surface that mirrors how teams actually run multi-step AI work in 2026.
              </p>
              <ul className="mt-8 space-y-3 text-neutral-300">
                {[
                  'Compose graphs of agents with explicit handoffs and guardrails.',
                  'Run batches in parallel while keeping observability front and center.',
                  'Drop in skills and tools where they belong—see the graph, not a black box.',
                ].map((line) => (
                  <li key={line} className="flex gap-3">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </FadeUp>
            <FadeUp delay={0.08}>
              <div className="glass-panel relative overflow-hidden rounded-2xl p-8">
                <div className="absolute -right-20 -top-20 h-56 w-56 rounded-full bg-violet-500/15 blur-3xl" />
                <div className="absolute -bottom-16 -left-16 h-48 w-48 rounded-full bg-cyan-500/10 blur-3xl" />
                <div className="relative flex items-center gap-2 text-cyan-300/95">
                  <Network className="h-5 w-5" aria-hidden />
                  <span className="text-sm font-semibold uppercase tracking-wider">Agent mesh</span>
                </div>
                <p className="relative mt-4 text-lg font-medium leading-relaxed text-white">
                  The canvas is the contract: nodes are agents, edges are intent, and the layout is
                  yours to evolve as workflows mature.
                </p>
                <p className="relative mt-4 font-mono text-sm text-neutral-500">
                  <span className="code-inline text-neutral-400">~/.claude/skills/</span> and repo-local
                  skills sit alongside first-class integrations—documented, diffable, and boring in the
                  best way.
                </p>
              </div>
            </FadeUp>
          </div>
        </MotionSection>

        {/* Core features */}
        <MotionSection id="features" className="border-y border-white/[0.06] bg-bg-elevated/50 py-20 sm:py-28">
          <div className="mx-auto max-w-[90rem] px-4 sm:px-6 lg:px-10">
            <FadeUp className="max-w-2xl">
              <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">Core features</h2>
              <p className="mt-4 text-lg leading-relaxed text-neutral-400">
                Everything is tuned for scannability: bold titles, short copy, and cards that lift
                slightly on hover—premium without the noise.
              </p>
            </FadeUp>

            <div className="mt-14 grid gap-5 lg:grid-cols-12">
              <FadeUp className="lg:col-span-7">
                <article className="glass-panel group flex h-full flex-col rounded-2xl p-6 transition duration-200 hover:-translate-y-0.5 hover:border-cyan-400/25 hover:shadow-[0_20px_50px_-24px_rgba(34,211,238,0.25)] sm:p-8">
                  <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
                    <div className="min-w-0 flex-1">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-400/10 text-cyan-300 ring-1 ring-cyan-400/25">
                        <LayoutDashboardIcon />
                      </div>
                      <h3 className="mt-5 text-xl font-bold text-white">Visual canvas dashboard</h3>
                      <p className="mt-3 text-sm leading-relaxed text-neutral-400 sm:text-base">
                        Pan, zoom, and rearrange agents as living infrastructure. Status chips and
                        edges stay readable under load—this is the hero surface of OpenSwarm.
                      </p>
                    </div>
                    <div className="w-full shrink-0 lg:max-w-[340px]">
                      <CanvasPreview />
                    </div>
                  </div>
                </article>
              </FadeUp>
              <div className="grid gap-5 lg:col-span-5">
                {[
                  {
                    title: 'Parallel runs with guardrails',
                    body: 'Fan out work, merge results, and keep policy checks attached to the graph—not buried in logs.',
                  },
                  {
                    title: 'Workflow templates',
                    body: 'Start from research, content, analysis, or automation presets—then fork into your own layout.',
                  },
                  {
                    title: 'Developer-native ergonomics',
                    body: 'Keyboard-friendly navigation, monospace hints for paths and commands, and Git-first workflows.',
                  },
                ].map((f) => (
                  <FadeUp key={f.title}>
                    <article className="glass-panel group h-full rounded-2xl p-6 transition duration-200 hover:-translate-y-0.5 hover:border-cyan-400/20 hover:shadow-[0_16px_40px_-28px_rgba(34,211,238,0.2)]">
                      <h3 className="text-lg font-bold text-white">{f.title}</h3>
                      <p className="mt-2 text-sm leading-relaxed text-neutral-400">{f.body}</p>
                    </article>
                  </FadeUp>
                ))}
              </div>
            </div>

            <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {[
                {
                  title: 'Integrations hub',
                  body: 'Connect the tools your team already lives in—email, docs, issue trackers, and design files.',
                },
                {
                  title: 'Observable execution',
                  body: 'Lightweight traces per node so you can answer “what ran, where, and why” without leaving the canvas.',
                },
              ].map((f) => (
                <FadeUp key={f.title}>
                  <article className="glass-panel group h-full rounded-2xl p-6 transition duration-200 hover:-translate-y-0.5 hover:border-cyan-400/20">
                    <h3 className="text-lg font-bold text-white">{f.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-neutral-400">{f.body}</p>
                  </article>
                </FadeUp>
              ))}
            </div>
          </div>
        </MotionSection>

        {/* Get running */}
        <MotionSection id="get-running" className="py-20 sm:py-28">
          <div className="mx-auto max-w-[90rem] px-4 sm:px-6 lg:px-10">
            <div className="grid gap-12 lg:grid-cols-2 lg:items-start">
              <FadeUp>
                <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">Get running</h2>
                <p className="mt-4 text-lg text-neutral-400">
                  Three steps from zero to a local orchestrator—copy, configure, run.
                </p>
                <ol className="mt-10 space-y-6">
                  {[
                    {
                      step: '01',
                      title: 'Clone the repository',
                      body: 'Pull the latest main branch and open it in your editor of choice.',
                    },
                    {
                      step: '02',
                      title: 'Install dependencies',
                      body: 'Follow the README for runtime versions—keep it boring and reproducible.',
                    },
                    {
                      step: '03',
                      title: 'Launch the canvas',
                      body: 'Start the dev server, open the UI, and pin your first agent graph.',
                    },
                  ].map((row) => (
                    <li key={row.step} className="flex gap-4">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-cyan-400/30 bg-cyan-400/10 font-mono text-xs font-bold text-cyan-200">
                        {row.step}
                      </span>
                      <div>
                        <p className="font-semibold text-white">{row.title}</p>
                        <p className="mt-1 text-sm text-neutral-400">{row.body}</p>
                      </div>
                    </li>
                  ))}
                </ol>
                <a href={LINKS.downloadMac} className={'mt-10 ' + btnPrimary}>
                  Download for Mac
                </a>
              </FadeUp>
              <FadeUp delay={0.06}>
                <div className="glass-panel rounded-2xl p-6 font-mono text-sm leading-relaxed">
                  <div className="flex items-center justify-between text-xs text-neutral-500">
                    <span>terminal</span>
                    <span className="rounded-md bg-white/[0.06] px-2 py-0.5 text-[10px] uppercase tracking-wider">
                      bash
                    </span>
                  </div>
                  <pre className="mt-5 overflow-x-auto text-[13px] leading-relaxed text-cyan-100/95">
                    {`git clone https://github.com/openswarm/openswarm.git
cd openswarm
# see README for env + first run
npm install && npm run dev`}
                  </pre>
                  <p className="mt-5 text-xs text-neutral-500">
                    Commands are illustrative; replace with the canonical steps from the repository
                    README when you wire your release.
                  </p>
                </div>
              </FadeUp>
            </div>
          </div>
        </MotionSection>

        {/* Workflows */}
        <MotionSection id="workflows" className="border-y border-white/[0.06] bg-bg-elevated/35 py-20 sm:py-28">
          <div className="mx-auto max-w-[90rem] px-4 sm:px-6 lg:px-10">
            <FadeUp className="max-w-2xl">
              <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">Workflows</h2>
              <p className="mt-4 text-lg text-neutral-400">
                Four patterns teams reach for first—each maps cleanly to parallel lanes on the
                canvas.
              </p>
            </FadeUp>
            <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  title: 'Research',
                  body: 'Fan out source gathering, dedupe findings, and merge into a single brief—agents run side by side.',
                  icon: '↔',
                },
                {
                  title: 'Content',
                  body: 'Draft, critique, and format in passes you can see: every hop is a node, every merge is explicit.',
                  icon: '◇',
                },
                {
                  title: 'Analysis',
                  body: 'Split metrics exploration from narrative synthesis so numbers stay honest and prose stays sharp.',
                  icon: '⊕',
                },
                {
                  title: 'Automation',
                  body: 'Trigger integrations on a schedule or webhook—keep human checkpoints as hard stops on the graph.',
                  icon: '⟡',
                },
              ].map((w) => (
                <FadeUp key={w.title}>
                  <article className="glass-panel group flex h-full flex-col rounded-2xl p-6 transition duration-200 hover:-translate-y-0.5 hover:border-violet-400/20">
                    <span
                      className="text-2xl text-cyan-400/90"
                      aria-hidden
                    >
                      {w.icon}
                    </span>
                    <h3 className="mt-4 text-lg font-bold text-white">{w.title}</h3>
                    <p className="mt-2 flex-1 text-sm leading-relaxed text-neutral-400">{w.body}</p>
                    <div className="mt-5 flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-cyan-500/80">
                      <Workflow className="h-3.5 w-3.5" aria-hidden />
                      Parallel lanes
                    </div>
                  </article>
                </FadeUp>
              ))}
            </div>
          </div>
        </MotionSection>

        {/* Works with */}
        <MotionSection className="py-20 sm:py-24">
          <div className="mx-auto max-w-[90rem] px-4 sm:px-6 lg:px-10">
            <FadeUp className="max-w-2xl">
              <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">Works with</h2>
              <p className="mt-4 text-neutral-400">
                Grayscale tiles brighten on hover—swap in SVG marks when you have brand assets.
              </p>
            </FadeUp>
            <FadeUp delay={0.06} className="mt-10">
              <div className="flex flex-wrap gap-3 sm:gap-4">
                {[...PARTNERS, ...PARTNERS].map((name, i) => (
                  <div
                    key={`${name}-${i}`}
                    className="group flex min-w-[7.5rem] flex-1 items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-4 text-center text-sm font-semibold text-neutral-500 transition duration-200 hover:scale-[1.02] hover:border-cyan-400/25 hover:text-cyan-200 sm:min-w-[8.5rem] sm:flex-none sm:px-5"
                  >
                    <span className="transition group-hover:text-cyan-200">{name}</span>
                  </div>
                ))}
              </div>
            </FadeUp>
          </div>
        </MotionSection>

        {/* CTA banner */}
        <MotionSection className="pb-24 pt-4">
          <div className="mx-auto max-w-[90rem] px-4 sm:px-6 lg:px-10">
            <FadeUp>
              <div className="relative overflow-hidden rounded-[1.75rem] border border-cyan-400/20 bg-gradient-to-br from-cyan-500/10 via-transparent to-violet-600/15 px-8 py-12 text-center sm:px-14 sm:py-16">
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(34,211,238,0.12),transparent_55%)]" />
                <h2 className="relative text-3xl font-bold tracking-tight text-white sm:text-4xl">
                  Start orchestrating
                </h2>
                <p className="relative mx-auto mt-4 max-w-xl text-lg text-neutral-300">
                  MIT licensed, community-driven, and designed to stay fast. Grab the source or ship
                  the Mac build—your canvas is waiting.
                </p>
                <div className="relative mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
                  <a href={LINKS.github} className={btnPrimary}>
                    <Github className="h-5 w-5" aria-hidden />
                    Open GitHub
                    <ArrowRight className="h-4 w-4 opacity-80" aria-hidden />
                  </a>
                  <a href={LINKS.downloadMac} className={btnOutline}>
                    Latest release
                  </a>
                </div>
                <p className="relative mt-8 text-sm text-neutral-500">
                  <span className="rounded-full border border-white/10 bg-black/30 px-3 py-1 font-medium text-neutral-400">
                    MIT License
                  </span>
                  <span className="mx-2 text-neutral-600">·</span>
                  Free and open source
                </p>
              </div>
            </FadeUp>
          </div>
        </MotionSection>
      </main>

      <footer className="border-t border-white/[0.06] bg-[#080808] py-8">
        <div className="mx-auto flex max-w-[90rem] flex-col gap-6 px-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-10">
          <div className="flex items-center gap-2 text-sm text-neutral-500">
            <SwarmLogoMark className="h-8 w-8 opacity-90" />
            <span>© {new Date().getFullYear()} OpenSwarm · MIT</span>
          </div>
          <div className="flex flex-wrap gap-6 text-sm font-medium text-neutral-400">
            <a href={LINKS.github} className="no-underline hover:text-white">
              GitHub
            </a>
            <a href="#features" className="no-underline hover:text-white">
              Features
            </a>
            <a href="#get-running" className="no-underline hover:text-white">
              Get running
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}

function LayoutDashboardIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden fill="none" stroke="currentColor">
      <rect x="3" y="3" width="7" height="9" rx="1.5" strokeWidth="2" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" strokeWidth="2" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" strokeWidth="2" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" strokeWidth="2" />
    </svg>
  )
}
