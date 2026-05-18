import { ArrowRight, BrainCircuit, RefreshCw, TrendingUp, Zap } from 'lucide-react'
import { Header } from '../components/Header'

const LINKS = {
  demo: 'https://demo.lextures.com/',
  github: 'https://github.com/StudyDrift/lextures',
} as const

const PROBLEMS = [
  {
    title: 'You don\'t know what you don\'t know',
    body: 'Re-reading notes feels productive. It isn\'t. Without something that tests your recall, you mistake familiarity for understanding—and the gaps only show up when it counts.',
  },
  {
    title: 'You forget faster than you learn',
    body: 'The forgetting curve is steep. Without scheduled review, most of what you learned last week is gone by next week—regardless of how hard you studied.',
  },
  {
    title: 'Generic content doesn\'t match your actual gaps',
    body: 'A YouTube playlist or a textbook covers everything. You need practice on the specific concepts you\'re shaky on—not another tour through the parts you already understand.',
  },
]

const FEATURES = [
  {
    icon: BrainCircuit,
    title: 'Adaptive delivery always finds the right challenge',
    body: 'Item Response Theory builds a running model of what you know. Every question is selected because it will tell the system something useful about your current ability—not because it\'s next in a sequence.',
  },
  {
    icon: RefreshCw,
    title: 'Spaced repetition so you never cram again',
    body: 'The SRS engine schedules review at the moment just before you\'re predicted to forget. Initial intervals are short; as you prove retention, they grow to days, then weeks. Knowledge compounds instead of evaporating.',
  },
  {
    icon: Zap,
    title: 'Generate a question bank from anything you\'re studying',
    body: 'Paste in a textbook excerpt, a set of notes, or a list of learning objectives. Lextures generates a calibrated question bank in seconds, tagged by concept, ready to practice.',
  },
  {
    icon: TrendingUp,
    title: 'See exactly where you stand',
    body: 'Your ability estimate is updated after every question. The dashboard shows which concepts are mastered, which are shaky, and which are scheduled for review—so you always know where to focus next.',
  },
]

export function SelfLearnerPage() {
  return (
    <div className="relative min-h-screen overflow-x-hidden bg-stone-50 text-slate-700">
      <Header />

      <main>
        {/* Hero */}
        <section className="border-b border-stone-200/90 bg-white py-20 sm:py-28">
          <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.3em] text-stone-500">
              Self-Learner
            </p>
            <h1 className="mt-5 max-w-3xl text-4xl font-semibold leading-tight tracking-tight text-stone-900 sm:text-5xl lg:text-[3.25rem]">
              Stop guessing what to study next
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-stone-600">
              An adaptive engine that builds a model of exactly what you know, schedules review before you forget, and always puts the right question in front of you—without an instructor in the loop.
            </p>
            <div className="mt-10 flex flex-wrap gap-4">
              <a href="#/get-started" className="btn-primary gap-2 px-6 py-3">
                Try it free
                <ArrowRight className="h-4 w-4" aria-hidden />
              </a>
              <a href="#/pricing" className="btn-secondary px-6 py-3">
                See pricing
              </a>
            </div>
          </div>
        </section>

        {/* Problems */}
        <section className="py-16 sm:py-20">
          <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl font-semibold tracking-tight text-stone-900 sm:text-3xl">
              Why self-directed studying usually fails
            </h2>
            <div className="mt-10 grid gap-5 sm:grid-cols-3">
              {PROBLEMS.map(({ title, body }) => (
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
                How it works
              </p>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight text-stone-900 sm:text-3xl">
                A system that works the way your memory actually works
              </h2>
            </div>
            <div className="mt-12 grid gap-5 sm:grid-cols-2">
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

        {/* How it fits into a study session */}
        <section className="border-t border-stone-200/90 bg-stone-50 py-16 sm:py-20">
          <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
            <div className="grid gap-10 lg:grid-cols-2 lg:items-center lg:gap-20">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight text-stone-900 sm:text-3xl">
                  What a study session actually looks like
                </h2>
                <p className="mt-4 text-base leading-relaxed text-stone-600">
                  You open Lextures. The dashboard shows you what is due for review today—concepts you learned earlier that are approaching the edge of your predicted recall window. You answer fifteen questions in twelve minutes. Ten are review; five are new material calibrated to your current ability level.
                </p>
                <p className="mt-4 text-base leading-relaxed text-stone-600">
                  After each session, your ability estimates update. The concepts you answered correctly push their next review further out. The ones you missed come back sooner. Tomorrow\'s session is shorter because today\'s was efficient.
                </p>
                <p className="mt-4 text-base leading-relaxed text-stone-600">
                  There is no syllabus to follow, no chapter to "finish." The system tracks what you know and builds toward what you want to know—at whatever pace fits your schedule.
                </p>
              </div>
              <div className="space-y-3">
                {[
                  { step: '1', title: 'Create or import a course', desc: 'Build a question bank from your notes, or import one. Lextures AI generates questions from raw text in seconds.' },
                  { step: '2', title: 'Answer questions adaptively', desc: 'Every question is selected to maximally reduce uncertainty about your current ability level.' },
                  { step: '3', title: 'Come back for scheduled review', desc: 'The SRS engine queues up the right concepts at the right time. Sessions stay short because they stay targeted.' },
                  { step: '4', title: 'Watch mastery accumulate', desc: 'Ability estimates update in real time. Your dashboard shows where you stand on every concept, not just your last score.' },
                ].map(({ step, title, desc }) => (
                  <div key={step} className="flex gap-4 rounded-xl border border-stone-200/90 bg-white px-5 py-4">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-white">
                      {step}
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-stone-900">{title}</p>
                      <p className="mt-1 text-sm leading-relaxed text-stone-500">{desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Use cases */}
        <section className="border-t border-stone-200/90 bg-white py-16 sm:py-20">
          <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl font-semibold tracking-tight text-stone-900 sm:text-3xl">
              Who uses Lextures as a self-learner
            </h2>
            <div className="mt-8 grid gap-5 sm:grid-cols-3">
              {[
                {
                  label: 'Professional certification',
                  desc: 'Studying for a bar exam, a medical board, a CPA, or a cloud certification—high-stakes tests where covering material is not enough. You need retained mastery under pressure.',
                },
                {
                  label: 'Language acquisition',
                  desc: 'Vocabulary and grammar that fade without structured review. Spaced repetition is the most evidence-backed approach to language retention; Lextures applies it automatically.',
                },
                {
                  label: 'Independent coursework',
                  desc: 'Working through a textbook, an online course, or a structured curriculum on your own timeline—with the scaffolding of an adaptive system rather than just a reading list.',
                },
              ].map(({ label, desc }) => (
                <div key={label} className="rounded-xl border border-stone-200/90 bg-stone-50 p-6">
                  <h3 className="font-semibold text-stone-900">{label}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-stone-600">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="border-t border-stone-200/90 bg-stone-50 py-16 sm:py-20">
          <div className="mx-auto max-w-3xl px-4 text-center sm:px-6 lg:px-8">
            <h2 className="text-2xl font-semibold tracking-tight text-stone-900 sm:text-3xl">
              Free for your first five courses
            </h2>
            <p className="mx-auto mt-4 max-w-md text-base leading-relaxed text-stone-600">
              Create an account, import your materials, and start a study session today. No credit card required.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a href="#/get-started" className="btn-primary gap-2 px-6 py-3">
                Start for free
                <ArrowRight className="h-4 w-4" aria-hidden />
              </a>
              <a href="#/pricing" className="btn-secondary px-6 py-3">
                See pricing
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
