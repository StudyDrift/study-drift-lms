import { ChevronDown } from 'lucide-react'
import { useState, type ReactNode } from 'react'

type SidebarSectionProps = {
  title: string
  defaultOpen?: boolean
  children: ReactNode
}

/** Collapsible panel for settings sidebars (Gutenberg-style). */
export function SidebarSection({ title, defaultOpen = true, children }: SidebarSectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-b border-slate-200 pb-3 last:border-0">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 py-2 text-left text-[13px] font-semibold text-slate-800"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {title}
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-slate-500 transition ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>
      {open && <div className="mt-1 space-y-3 text-sm">{children}</div>}
    </div>
  )
}
