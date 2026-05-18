import { ArrowRight, BarChart3, BrainCircuit, GraduationCap, RefreshCw, ShieldCheck, Users, Zap } from 'lucide-react'
import { Header } from '../components/Header'

const LINKS = {
  demo: 'https://demo.lextures.com/',
  github: 'https://github.com/StudyDrift/lextures',
} as const

const CHALLENGES = [
  {
    title: 'Standards are non-negotiable',
    body: 'Every assignment, quiz, and grade needs to map to CCSS, NGSS, or your state framework. Tools that treat standards alignment as an optional add-on create compliance debt that compounds over time.',
  },
  {
    title: 'Rosters change constantly',
    body: 'Students transfer, sections merge, and the SIS is the source of truth—not the LMS. Manual roster management at district scale is an error waiting to happen on the day it matters most.',
  },
  {
    title: 'Accommodations must be automatic',
    body: 'A 504 plan or IEP that requires a teacher to remember to click "extended time" before every quiz is not an accommodation—it is a liability. Compliance has to be built in, not bolted on.',
  },
]

const FEATURES = [
  {
    icon: BarChart3,
    title: 'CCSS, NGSS, and custom standards alignment',
    body: 'Map every question and assignment to state and national standards at creation time. Mastery rolls up by standard so teachers see where each student actually stands—not just their overall grade.',
  },
  {
    icon: Users,
    title: 'Clever, ClassLink, and OneRoster 1.2 roster sync',
    body: 'Connect to your district\'s SIS through Clever or ClassLink. Rosters sync automatically—new students appear, transfers disappear. OneRoster 1.2 CSV for districts that manage sync themselves.',
  },
  {
    icon: ShieldCheck,
    title: 'Accommodations applied automatically',
    body: 'Extended time and reduced-distraction mode are configured once at the platform level and applied to every assessment automatically. Teachers do not manage accommodations per quiz; the system does.',
  },
  {
    icon: GraduationCap,
    title: 'Misconception detection for lesson planning',
    body: 'When most of a class selects the same wrong answer, Lextures flags it before the next class session—not after the unit test. Teachers walk in knowing exactly which concept to reteach.',
  },
  {
    icon: RefreshCw,
    title: 'Spaced repetition across the school year',
    body: 'Content mastered in September does not need to be crammed back in before May standardized tests. The SRS engine schedules low-stakes review at optimal intervals so knowledge accumulates instead of decaying.',
  },
  {
    icon: Zap,
    title: 'AI-generated questions from learning objectives',
    body: 'Type a learning objective and get a calibrated question bank in seconds. Questions are tagged to standards automatically. Teachers review, adjust, and publish—without building from scratch.',
  },
]

const STANDARDS = ['CCSS', 'NGSS', 'Custom standards', 'Clever SSO', 'ClassLink SSO', 'OneRoster 1.2', 'SCIM 2.0', 'LTI 1.3']

export function K12Page() {
  return (
    <div className="relative min-h-screen overflow-x-hidden bg-stone-50 text-slate-700">
      <Header />

      <main>
        {/* Hero */}
        <section className="border-b border-stone-200/90 bg-white py-20 sm:py-28">
          <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.3em] text-stone-500">
              K–12
            </p>
            <h1 className="mt-5 max-w-3xl text-4xl font-semibold leading-tight tracking-tight text-stone-900 sm:text-5xl lg:text-[3.25rem]">
              Built for the standards, systems, and realities of K–12
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-stone-600">
              Standards-aligned assessments, automatic roster sync from your district SIS, and accommodations that apply without teacher intervention—so the administrative layer of teaching gets out of the way.
            </p>
            <div className="mt-10 flex flex-wrap gap-4">
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

        {/* Challenges */}
        <section className="py-16 sm:py-20">
          <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl font-semibold tracking-tight text-stone-900 sm:text-3xl">
              Where K–12 assessment tools usually fall short
            </h2>
            <div className="mt-10 grid gap-5 sm:grid-cols-3">
              {CHALLENGES.map(({ title, body }) => (
                <div key={title} className="rounded-xl border border-stone-200/90 bg-white p-6">
                  <h3 className="font-semibold text-stone-900">{title}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-stone-600">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="border-t border-stone-200/90 bg-white py-16 sm:py-20">
          <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
            <div className="max-w-2xl">
              <p className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-stone-500">
                How Lextures helps
              </p>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight text-stone-900 sm:text-3xl">
                Compliance built in. Insight built up.
              </h2>
            </div>
            <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ icon: Icon, title, body }) => (
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

        {/* Spaced repetition callout */}
        <section className="border-t border-stone-200/90 bg-stone-50 py-16 sm:py-20">
          <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
            <div className="grid gap-10 lg:grid-cols-2 lg:items-center lg:gap-20">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight text-stone-900 sm:text-3xl">
                  Retention across the school year, not just the unit
                </h2>
                <p className="mt-4 text-base leading-relaxed text-stone-600">
                  The forgetting curve is not a metaphor. Content mastered in a September unit test is largely gone by the time state assessments arrive in spring. Spaced repetition scheduling (SRS) attacks this directly: the system schedules short, low-stakes review at scientifically optimal intervals—close together at first, then increasingly spaced as the student demonstrates retention.
                </p>
                <p className="mt-4 text-base leading-relaxed text-stone-600">
                  For teachers, this means the platform is doing active instructional work between formal class sessions. Students who stay engaged with scheduled review arrive at high-stakes tests having maintained mastery, not scrambling to re-learn.
                </p>
              </div>
              <div className="space-y-4">
                {[
                  { label: 'September', desc: 'Concept introduced and assessed. Mastery confirmed.' },
                  { label: 'October', desc: 'SRS schedules first review. Two minutes, three questions.' },
                  { label: 'December', desc: 'Second review, now spaced two months out. Still retained.' },
                  { label: 'April', desc: 'State assessment. No cramming required.' },
                ].map(({ label, desc }) => (
                  <div key={label} className="flex gap-4 rounded-xl border border-stone-200/90 bg-white px-5 py-4">
                    <span className="mt-0.5 text-xs font-semibold uppercase tracking-widest text-accent">{label}</span>
                    <span className="text-sm leading-relaxed text-stone-600">{desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Standards tags */}
        <section className="border-t border-stone-200/90 bg-white py-14">
          <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
            <p className="text-sm font-semibold text-stone-900">Standards, identity, and roster protocols supported</p>
            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
              {STANDARDS.map((tag) => (
                <span key={tag} className="text-sm font-medium text-stone-500">{tag}</span>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="border-t border-stone-200/90 bg-stone-50 py-16 sm:py-20">
          <div className="mx-auto max-w-3xl px-4 text-center sm:px-6 lg:px-8">
            <h2 className="text-2xl font-semibold tracking-tight text-stone-900 sm:text-3xl">
              See what your teachers and students would actually use
            </h2>
            <p className="mx-auto mt-4 max-w-md text-base leading-relaxed text-stone-600">
              The live demo walks through both the instructor and learner experience—standards alignment, adaptive quizzes, and the teacher dashboard included.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a href="#/get-started" className="btn-primary gap-2 px-6 py-3">
                Open demo.lextures.com
                <ArrowRight className="h-4 w-4" aria-hidden />
              </a>
              <a href="#/pricing" className="btn-secondary px-6 py-3">
                View pricing
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
