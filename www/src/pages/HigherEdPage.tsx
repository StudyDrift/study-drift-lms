import { ArrowRight, BarChart3, BookOpen, BrainCircuit, GraduationCap, RefreshCw, ShieldCheck, Unplug } from 'lucide-react'
import { Header } from '../components/Header'

const LINKS = {
  demo: 'https://demo.lextures.com/',
  github: 'https://github.com/StudyDrift/lextures',
} as const

const CHALLENGES = [
  {
    title: 'Large cohorts, thin instructor bandwidth',
    body: 'A 300-seat lecture section cannot give every student individual feedback. Misconception patterns get missed until the midterm makes them visible—by then it is too late to intervene.',
  },
  {
    title: 'Every campus already has an LMS',
    body: 'Faculty are not going to abandon Canvas or Blackboard. New tools need to operate inside those systems, not alongside them—or adoption dies in the second week.',
  },
  {
    title: 'Accreditation requires a paper trail',
    body: 'Grade changes, accommodations, and outcome mapping need to be auditable. Spreadsheets and email threads are not a defensible record when a regional accreditor asks for evidence.',
  },
]

const FEATURES = [
  {
    icon: Unplug,
    title: 'LTI 1.3 inside Canvas, Blackboard, and Moodle',
    body: 'Lextures runs as an LTI 1.3 provider. Students launch assignments directly from the LMS they already use. Grades pass back via AGS. No new login, no tab-switching.',
  },
  {
    icon: BrainCircuit,
    title: 'IRT-based adaptive quizzing at section scale',
    body: 'Item Response Theory calibrates questions across every student in every section. A student in a 300-seat lecture gets items matched to their current ability level—not a one-size-fits-all quiz.',
  },
  {
    icon: GraduationCap,
    title: 'Misconception detection across large cohorts',
    body: 'When 60% of a section chooses the same wrong answer, that is a teaching signal—not random noise. Lextures surfaces these patterns automatically so instructors can address them before the next class session.',
  },
  {
    icon: ShieldCheck,
    title: 'SAML 2.0 and OIDC for institutional identity',
    body: 'Single sign-on through your institution\'s identity provider. No separate credential management. Users are auto-provisioned on first login and deprovisioned when they leave.',
  },
  {
    icon: BookOpen,
    title: 'Canvas import and QTI 2.1/3.0',
    body: 'Migrate courses, question banks, and grades from Canvas with AI-assisted mapping. Import QTI 2.1 or 3.0 from any major LMS. Item calibration data travels with the question bank.',
  },
  {
    icon: BarChart3,
    title: 'Audit-ready grading for appeals and accreditation',
    body: 'Every grade change logs who changed it, when, and why. Outcome-to-assignment mappings are exportable for accreditation reviews. Grade exports are structured for defensible evidence, not just summary statistics.',
  },
]

const INTEGRATIONS = [
  'LTI 1.3', 'SAML 2.0', 'OIDC', 'Canvas import',
  'QTI 2.1 / 3.0', 'OneRoster 1.2', 'SCIM 2.0', 'AGS grade passback',
]

export function HigherEdPage() {
  return (
    <div className="relative min-h-screen overflow-x-hidden bg-stone-50 text-slate-700">
      <Header />

      <main>
        {/* Hero */}
        <section className="border-b border-stone-200/90 bg-white py-20 sm:py-28">
          <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.3em] text-stone-500">
              Higher Education
            </p>
            <h1 className="mt-5 max-w-3xl text-4xl font-semibold leading-tight tracking-tight text-stone-900 sm:text-5xl lg:text-[3.25rem]">
              Assessment infrastructure built for how universities actually run
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-stone-600">
              Adaptive quizzing at section scale, LTI integration with every major LMS, and grading records that hold up under accreditation review—without replacing the tools your faculty already use.
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
              Where higher education assessment actually breaks down
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
                Built around the workflows that break first at scale
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

        {/* Multi-section callout */}
        <section className="border-t border-stone-200/90 bg-stone-50 py-16 sm:py-20">
          <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
            <div className="grid gap-10 lg:grid-cols-2 lg:items-center lg:gap-20">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight text-stone-900 sm:text-3xl">
                  Course blueprints for multi-section departments
                </h2>
                <p className="mt-4 text-base leading-relaxed text-stone-600">
                  When ten instructors teach the same course, consistency is a policy problem, not a technical one. Course blueprints let a department coordinator maintain a master template and push updates to every child section simultaneously—syllabus changes, new question bank items, updated rubrics—without requiring individual faculty action.
                </p>
                <p className="mt-4 text-base leading-relaxed text-stone-600">
                  Each section retains the ability to add local content while inheriting the shared foundation. Gradebook exports from all sections roll up into a single outcome report for accreditation.
                </p>
              </div>
              <div className="rounded-xl border border-stone-200/90 bg-white p-8 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]">
                <p className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-stone-500">
                  Design principle
                </p>
                <p className="mt-4 text-xl font-medium leading-snug text-stone-900">
                  If a registrar would wince at the data model, it does not ship.
                </p>
                <p className="mt-4 text-sm leading-relaxed text-stone-500">
                  Every schema decision in Lextures is made with the assumption that the data will eventually need to be exported, audited, or explained to someone outside your institution.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Integrations */}
        <section className="border-t border-stone-200/90 bg-white py-14">
          <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
            <p className="text-sm font-semibold text-stone-900">Standards and protocols supported</p>
            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
              {INTEGRATIONS.map((tag) => (
                <span key={tag} className="text-sm font-medium text-stone-500">{tag}</span>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="border-t border-stone-200/90 bg-stone-50 py-16 sm:py-20">
          <div className="mx-auto max-w-3xl px-4 text-center sm:px-6 lg:px-8">
            <h2 className="text-2xl font-semibold tracking-tight text-stone-900 sm:text-3xl">
              Walk the instructor and learner flows
            </h2>
            <p className="mx-auto mt-4 max-w-md text-base leading-relaxed text-stone-600">
              The live demo includes a full course with adaptive quizzes, gradebook, and LMS integration flows you can explore without a login.
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
