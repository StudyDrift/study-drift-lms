import { Github, Menu, X } from 'lucide-react'
import { useEffect, useState } from 'react'

const LINKS = {
  demo: 'https://demo.lextures.com/',
  github: 'https://github.com/StudyDrift/lextures',
} as const

const NAV = [
  { label: 'Features', href: '#features' },
  { label: 'Adaptive AI', href: '#ai' },
  { label: 'Institutions', href: '#institutions' },
  { label: 'Integrations', href: '#integrations' },
  { label: 'Blog', href: '#/blog' },
] as const

function LogoMark({ className = '' }: { className?: string }) {
  return <img src="./logo.svg" className={className} alt="" aria-hidden />
}

export function Header() {
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [menuOpen])

  const closeMenu = () => setMenuOpen(false)

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-stone-200/80 bg-stone-50/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <a href="#/" className="flex items-center gap-2.5 no-underline">
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
            <a
              href={LINKS.github}
              className="p-2 text-stone-600 transition-colors hover:text-stone-900"
              aria-label="View on GitHub"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Github className="h-5 w-5" />
            </a>
            <a href={LINKS.demo} className="btn-primary">Try the demo</a>
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

