import { ChevronDown, Github, Menu, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

const LINKS = {
  demo: 'https://demo.lextures.com/',
  github: 'https://github.com/StudyDrift/lextures',
} as const

const INDUSTRIES = [
  { label: 'Higher Education', href: '#/higher-ed' },
  { label: 'K–12', href: '#/k-12' },
  { label: 'Self-Learner', href: '#/self-learner' },
]

function LogoMark({ className = '' }: { className?: string }) {
  return <img src="/logo.svg" className={className} alt="" aria-hidden />
}

function IndustriesDropdown({ onNavigate }: { onNavigate?: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        className="flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-stone-600 transition-colors hover:bg-stone-200/60 hover:text-stone-900"
      >
        Industries
        <ChevronDown
          className={`h-3.5 w-3.5 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1.5 w-44 overflow-hidden rounded-xl border border-stone-200 bg-white shadow-lg shadow-stone-900/10">
          {INDUSTRIES.map((item) => (
            <a
              key={item.href}
              href={item.href}
              onClick={() => { setOpen(false); onNavigate?.() }}
              className="block px-4 py-2.5 text-sm font-medium text-stone-700 no-underline transition-colors hover:bg-stone-50 hover:text-stone-900"
            >
              {item.label}
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

export function Header() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [mobileIndustriesOpen, setMobileIndustriesOpen] = useState(false)

  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [menuOpen])

  const closeMenu = () => {
    setMenuOpen(false)
    setMobileIndustriesOpen(false)
  }

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-stone-200/80 bg-stone-50/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <a href="#/" className="flex items-center gap-2.5 no-underline">
            <LogoMark className="h-8 w-8 shrink-0" />
            <span className="text-base font-semibold tracking-tight text-stone-900">Lextures</span>
          </a>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
            <a
              href="#features"
              className="rounded-lg px-3 py-2 text-sm font-medium text-stone-600 no-underline transition-colors hover:bg-stone-200/60 hover:text-stone-900"
            >
              Features
            </a>
            <IndustriesDropdown />
            <a
              href="#/pricing"
              className="rounded-lg px-3 py-2 text-sm font-medium text-stone-600 no-underline transition-colors hover:bg-stone-200/60 hover:text-stone-900"
            >
              Pricing
            </a>
            <a
              href="#/blog"
              className="rounded-lg px-3 py-2 text-sm font-medium text-stone-600 no-underline transition-colors hover:bg-stone-200/60 hover:text-stone-900"
            >
              Blog
            </a>
            <a
              href="/docs"
              className="rounded-lg px-3 py-2 text-sm font-medium text-stone-600 no-underline transition-colors hover:bg-stone-200/60 hover:text-stone-900"
            >
              Documentation
            </a>
          </nav>

          <div className="hidden items-center gap-3 md:flex">
            <a
              href={LINKS.github}
              className="p-2 text-stone-600 transition-colors hover:text-stone-900"
              aria-label="View on GitHub"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Github className="h-5 w-5" />
            </a>
            <a href="#/get-started" className="btn-primary">Get Started</a>
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

          <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-4" aria-label="Mobile primary">
            <a
              href="#features"
              onClick={closeMenu}
              className="rounded-lg px-4 py-3.5 text-base font-medium text-stone-800 no-underline transition hover:bg-stone-200/50"
            >
              Features
            </a>

            {/* Industries accordion */}
            <div>
              <button
                type="button"
                onClick={() => setMobileIndustriesOpen((v) => !v)}
                className="flex w-full items-center justify-between rounded-lg px-4 py-3.5 text-base font-medium text-stone-800 transition hover:bg-stone-200/50"
                aria-expanded={mobileIndustriesOpen}
              >
                Industries
                <ChevronDown
                  className={`h-4 w-4 transition-transform duration-150 ${mobileIndustriesOpen ? 'rotate-180' : ''}`}
                  aria-hidden
                />
              </button>
              {mobileIndustriesOpen && (
                <div className="ml-4 mt-1 flex flex-col gap-1 border-l-2 border-stone-200 pl-4">
                  {INDUSTRIES.map((item) => (
                    <a
                      key={item.href}
                      href={item.href}
                      onClick={closeMenu}
                      className="rounded-lg px-3 py-2.5 text-sm font-medium text-stone-700 no-underline transition hover:bg-stone-200/50 hover:text-stone-900"
                    >
                      {item.label}
                    </a>
                  ))}
                </div>
              )}
            </div>

            <a
              href="#/pricing"
              onClick={closeMenu}
              className="rounded-lg px-4 py-3.5 text-base font-medium text-stone-800 no-underline transition hover:bg-stone-200/50"
            >
              Pricing
            </a>
            <a
              href="#/blog"
              onClick={closeMenu}
              className="rounded-lg px-4 py-3.5 text-base font-medium text-stone-800 no-underline transition hover:bg-stone-200/50"
            >
              Blog
            </a>
            <a
              href="/docs"
              onClick={closeMenu}
              className="rounded-lg px-4 py-3.5 text-base font-medium text-stone-800 no-underline transition hover:bg-stone-200/50"
            >
              Documentation
            </a>
          </nav>

          <div className="flex flex-col gap-3 border-t border-stone-200 p-4 pb-8">
            <a href="#/get-started" onClick={closeMenu} className="btn-primary w-full justify-center">
              Get Started
            </a>
            <a
              href={LINKS.github}
              onClick={closeMenu}
              className="btn-secondary w-full justify-center gap-2"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Github className="h-4 w-4" />
              View on GitHub
            </a>
          </div>
        </div>
      )}
    </>
  )
}
