import { type ReactNode, useState, useRef, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { useShellNav } from './use-shell-nav'

interface SideNavTooltipProps {
  children: ReactNode
  content: string
}

export function SideNavTooltip({ children, content }: SideNavTooltipProps) {
  const { sideNavCollapsed } = useShellNav()
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const measure = () => {
      if (ref.current) {
        const r = ref.current.getBoundingClientRect()
        // If the wrapper itself is display: contents or similar, r might be zero.
        // We ensure we have a valid position before showing.
        if (r.width > 0 || r.height > 0) {
          setPos({
            top: r.top + r.height / 2,
            left: r.right + 10,
          })
        }
      }
    }
    measure()
    // Small delay to ensure layout is settled in some edge cases
    const raf = requestAnimationFrame(measure)
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
    }
  }, [open, sideNavCollapsed])

  if (!sideNavCollapsed) return <>{children}</>

  return (
    <div
      ref={ref}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => {
        setOpen(false)
        setPos(null)
      }}
      className="flex w-full min-w-0"
    >
      {children}
      {open && pos &&
        createPortal(
          <div
            style={{ top: pos.top, left: pos.left }}
            className="tooltip-in fixed z-[100] whitespace-nowrap rounded-lg bg-slate-950 px-2.5 py-1.5 text-xs font-semibold text-white shadow-xl ring-1 ring-white/10 dark:bg-neutral-800"
          >
            {content}
            <div className="absolute -left-1 top-1/2 h-2 w-2 -translate-y-1/2 rotate-45 bg-slate-950 dark:bg-neutral-800" />
          </div>,
          document.body,
        )}
    </div>
  )
}
