import { ArrowLeft, BookOpen, BrainCircuit, GraduationCap, Search } from 'lucide-react'
import { useState } from 'react'
import { Header } from '../components/Header'

const LOGIN_URL = 'https://demo.lextures.com/'

// Fire-and-forget — never awaited, never surfaces errors to the user.
function trackOnboarding(program: string, schoolName?: string) {
  try {
    const apiBase = import.meta.env.VITE_API_BASE_URL ?? ''
    navigator.sendBeacon(
      `${apiBase}/api/v1/public/onboarding/track`,
      new Blob(
        [JSON.stringify({
          program,
          school_name: schoolName ?? '',
          language: navigator.language ?? '',
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? '',
          screen_width: window.screen.width,
          screen_height: window.screen.height,
          referrer: document.referrer,
        })],
        { type: 'application/json' },
      ),
    )
  } catch {
    // Never let analytics break the user flow.
  }
}

type Program = 'k-12' | 'higher-ed' | 'self-learner'
type Step = 'program' | 'school'

const PROGRAMS = [
  {
    id: 'k-12' as Program,
    icon: BookOpen,
    title: 'K–12',
    description: "I'm a student or teacher at a primary or secondary school.",
  },
  {
    id: 'higher-ed' as Program,
    icon: GraduationCap,
    title: 'Higher Education',
    description: "I'm a student or instructor at a college or university.",
  },
  {
    id: 'self-learner' as Program,
    icon: BrainCircuit,
    title: 'Self-Learner',
    description: "I'm studying independently, for a certification, or on my own schedule.",
  },
]

function ProgramStep({ onSelect }: { onSelect: (p: Program) => void }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
      <div className="text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-stone-900 sm:text-4xl">
          How are you using Lextures?
        </h1>
        <p className="mt-3 text-base leading-relaxed text-stone-500">
          Select the option that best describes you so we can point you in the right direction.
        </p>
      </div>

      <div className="mt-12 grid gap-4 sm:grid-cols-3">
        {PROGRAMS.map(({ id, icon: Icon, title, description }) => (
          <button
            key={id}
            type="button"
            onClick={() => onSelect(id)}
            className="group flex flex-col items-start gap-4 rounded-2xl border border-stone-200 bg-white p-6 text-left shadow-[0_1px_3px_rgba(28,25,23,0.05)] transition-all duration-150 hover:border-accent hover:shadow-[0_4px_16px_rgba(15,118,110,0.12)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent cursor-pointer"
          >
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-muted/70 text-accent transition-colors group-hover:bg-accent group-hover:text-white">
              <Icon className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <p className="font-semibold text-stone-900">{title}</p>
              <p className="mt-1.5 text-sm leading-relaxed text-stone-500">{description}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

function SchoolStep({ program, onBack }: { program: 'k-12' | 'higher-ed'; onBack: () => void }) {
  const [query, setQuery] = useState('')

  const isK12 = program === 'k-12'
  const label = isK12 ? 'school' : 'institution'
  const placeholder = isK12 ? 'e.g. Lincoln Middle School' : 'e.g. University of Michigan'

  function handleContinue() {
    if (!query.trim()) return
    trackOnboarding(program, query.trim())
    window.location.href = LOGIN_URL
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
      <button
        type="button"
        onClick={onBack}
        className="mb-8 flex items-center gap-1.5 text-sm font-medium text-stone-500 transition-colors hover:text-stone-800"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        Back
      </button>

      <h1 className="text-3xl font-semibold tracking-tight text-stone-900 sm:text-4xl">
        Find your {label}
      </h1>
      <p className="mt-3 text-base leading-relaxed text-stone-500">
        Enter the name of your {label} so your account is connected to the right place.
      </p>

      <div className="mt-10 space-y-4">
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5">
            <Search className="h-4 w-4 text-stone-400" aria-hidden />
          </div>
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleContinue()}
            placeholder={placeholder}
            className="block w-full rounded-xl border border-stone-200 bg-white py-3 pl-10 pr-4 text-base text-stone-900 placeholder-stone-400 shadow-sm outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </div>

        <button
          type="button"
          onClick={handleContinue}
          disabled={!query.trim()}
          className="btn-primary w-full justify-center py-3 text-base disabled:cursor-not-allowed disabled:opacity-40"
        >
          Continue
        </button>
      </div>
    </div>
  )
}

export function GetStartedPage() {
  const [step, setStep] = useState<Step>('program')
  const [program, setProgram] = useState<Program | null>(null)

  function handleProgramSelect(p: Program) {
    if (p === 'self-learner') {
      trackOnboarding('self-learner')
      window.location.href = LOGIN_URL
      return
    }
    setProgram(p)
    setStep('school')
  }

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-stone-50 text-slate-700">
      <Header />

      <main className="flex min-h-[calc(100vh-4rem)] items-start justify-center">
        {step === 'program' && (
          <ProgramStep onSelect={handleProgramSelect} />
        )}
        {step === 'school' && program && program !== 'self-learner' && (
          <SchoolStep
            program={program}
            onBack={() => setStep('program')}
          />
        )}
      </main>

      <footer className="border-t border-stone-200/90 bg-white py-10">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <p className="text-sm text-stone-400">© {new Date().getFullYear()} Lextures contributors</p>
        </div>
      </footer>
    </div>
  )
}
