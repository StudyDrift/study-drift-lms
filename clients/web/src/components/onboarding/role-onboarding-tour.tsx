import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { usePermissions } from '../../context/use-permissions'
import { PERM_COURSE_CREATE, PERM_RBAC_MANAGE } from '../../lib/rbac-api'

const STORAGE_KEY = 'lextures.onboarding.v1'

type RoleBucket = 'student' | 'teacher' | 'admin'

type TourStep = {
  id: string
  title: string
  body: string
  /** CSS selector for the element to spotlight (must exist on current route). */
  targetSelector: string
}

const STEPS: Record<RoleBucket, TourStep[]> = {
  student: [
    {
      id: 'nav',
      title: 'Find your courses',
      body: 'Use the left rail to jump between home, courses, inbox, and calendar. It stays consistent everywhere.',
      targetSelector: '[data-onboarding="side-nav"]',
    },
    {
      id: 'search',
      title: 'Jump with the keyboard',
      body: 'Press Cmd or Ctrl + K to open search. You can jump to pages, courses, and people without touching the mouse.',
      targetSelector: '[data-onboarding="command-palette"]',
    },
    {
      id: 'dashboard',
      title: 'Start from the dashboard',
      body: 'Your home view surfaces what is due soon and where to pick up reading or practice.',
      targetSelector: '[data-onboarding="dashboard-main"]',
    },
    {
      id: 'inbox',
      title: 'Stay in touch',
      body: 'Inbox keeps course messages and announcements in one place with the same folders you expect from email.',
      targetSelector: '[data-onboarding="nav-inbox"]',
    },
  ],
  teacher: [
    {
      id: 'nav',
      title: 'Course-aware navigation',
      body: 'Open a course and the rail switches to that course’s tools—modules, gradebook, settings—without losing context.',
      targetSelector: '[data-onboarding="side-nav"]',
    },
    {
      id: 'search',
      title: 'Command palette',
      body: 'Cmd/Ctrl + K searches courses, roster names, and destinations. It is the fastest way to reach a gradebook row.',
      targetSelector: '[data-onboarding="command-palette"]',
    },
    {
      id: 'dashboard',
      title: 'Teaching at a glance',
      body: 'The dashboard highlights deadlines and activity so you can triage before diving into a course shell.',
      targetSelector: '[data-onboarding="dashboard-main"]',
    },
    {
      id: 'inbox',
      title: 'Communicate',
      body: 'Use Inbox for direct messages; pair it with the course feed for channel-style discussions.',
      targetSelector: '[data-onboarding="nav-inbox"]',
    },
  ],
  admin: [
    {
      id: 'nav',
      title: 'Platform sections',
      body: 'Administrative tools stay under Settings while course work stays in the course shell.',
      targetSelector: '[data-onboarding="side-nav"]',
    },
    {
      id: 'search',
      title: 'Global search',
      body: 'The command palette reaches system settings routes when your role allows them.',
      targetSelector: '[data-onboarding="command-palette"]',
    },
    {
      id: 'dashboard',
      title: 'Operational overview',
      body: 'Return here after deep links; it is the anchor for keyboard shortcuts and notifications.',
      targetSelector: '[data-onboarding="dashboard-main"]',
    },
    {
      id: 'settings',
      title: 'Administration',
      body: 'Roles, AI models, and prompts live under Settings when you have platform permissions.',
      targetSelector: '[data-onboarding="nav-settings"]',
    },
  ],
}

function readDone(): Record<string, boolean> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const o = JSON.parse(raw) as Record<string, boolean>
    return typeof o === 'object' && o ? o : {}
  } catch {
    return {}
  }
}

function writeDone(bucket: RoleBucket, done: boolean) {
  try {
    const prev = readDone()
    prev[bucket] = done
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prev))
  } catch {
    /* ignore */
  }
}

function bucketForPermissions(allows: (p: string) => boolean): RoleBucket {
  if (allows(PERM_RBAC_MANAGE)) return 'admin'
  if (allows(PERM_COURSE_CREATE)) return 'teacher'
  return 'student'
}

function rectForSelector(sel: string): DOMRect | null {
  const el = document.querySelector(sel)
  if (!el) return null
  return el.getBoundingClientRect()
}

export function RoleOnboardingTour() {
  const { allows, loading } = usePermissions()
  const location = useLocation()
  const bucket = useMemo(() => bucketForPermissions(allows), [allows])
  const steps = STEPS[bucket]

  const [open, setOpen] = useState(false)
  const [index, setIndex] = useState(0)
  const [hole, setHole] = useState<{ top: number; left: number; width: number; height: number } | null>(null)
  const startedForBucket = useRef<string | null>(null)

  useEffect(() => {
    startedForBucket.current = null
  }, [bucket])

  useEffect(() => {
    if (loading) return
    if (location.pathname !== '/') return
    if (readDone()[bucket]) return
    if (startedForBucket.current === bucket) return
    startedForBucket.current = bucket
    queueMicrotask(() => {
      setOpen(true)
      setIndex(0)
    })
  }, [loading, bucket, location.pathname])

  const step = steps[index] ?? steps[0]!

  const measure = useCallback(() => {
    const r = rectForSelector(step.targetSelector)
    if (!r || r.width < 2 || r.height < 2) {
      setHole(null)
      return
    }
    const pad = 8
    setHole({
      top: r.top - pad,
      left: r.left - pad,
      width: r.width + pad * 2,
      height: r.height + pad * 2,
    })
  }, [step.targetSelector])

  useLayoutEffect(() => {
    if (!open) return
    const raf1 = requestAnimationFrame(() => measure())
    const ro = () => {
      requestAnimationFrame(() => measure())
    }
    window.addEventListener('resize', ro)
    window.addEventListener('scroll', ro, true)
    return () => {
      cancelAnimationFrame(raf1)
      window.removeEventListener('resize', ro)
      window.removeEventListener('scroll', ro, true)
    }
  }, [open, measure, index, location.pathname])

  const close = useCallback(
    (markDone: boolean) => {
      if (markDone) writeDone(bucket, true)
      setOpen(false)
    },
    [bucket],
  )

  if (!open) return null

  const last = index >= steps.length - 1

  const overlay: ReactNode = (
    <div className="fixed inset-0 z-[500]" role="presentation">
      <div className="absolute inset-0 bg-slate-950/55 dark:bg-black/60" />
      {hole ? (
        <div
          className="pointer-events-none absolute rounded-2xl shadow-[0_0_0_9999px_rgba(15,23,42,0.55)] ring-2 ring-indigo-400/90 dark:shadow-[0_0_0_9999px_rgba(0,0,0,0.65)] dark:ring-indigo-300/80"
          style={{
            top: hole.top,
            left: hole.left,
            width: hole.width,
            height: hole.height,
          }}
        />
      ) : null}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="pointer-events-auto w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-neutral-700 dark:bg-neutral-900">
          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
            Step {index + 1} of {steps.length}
          </p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-900 dark:text-neutral-100">{step.title}</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-neutral-300">{step.body}</p>
          {!hole ? (
            <p className="mt-2 text-xs text-amber-800 dark:text-amber-200">
              This screen layout does not expose this control yet — use Next to continue the tour.
            </p>
          ) : null}
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-800"
              onClick={() => close(true)}
            >
              Skip
            </button>
            {index > 0 ? (
              <button
                type="button"
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-800"
                onClick={() => setIndex((i) => Math.max(0, i - 1))}
              >
                Back
              </button>
            ) : null}
            <button
              type="button"
              className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 dark:bg-indigo-500 dark:hover:bg-indigo-400"
              onClick={() => {
                if (last) close(true)
                else setIndex((i) => i + 1)
              }}
            >
              {last ? 'Done' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )

  return createPortal(overlay, document.body)
}
