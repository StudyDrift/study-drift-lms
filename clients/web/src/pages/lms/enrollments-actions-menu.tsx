import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown, GraduationCap, UserPlus, Users } from 'lucide-react'

type EnrollmentsActionsMenuProps = {
  disabled?: boolean
  canEnrollSelfAsStudent: boolean
  onEnrollAsStudent: () => void
  enrollAsStudentBusy: boolean
  onAddEnrollment: () => void
  /** When true, shows a checked "Enable groups" state (still clickable as no-op or refresh). */
  groupsEnabled: boolean
  canToggleGroups: boolean
  onEnableGroups: () => void
  enableGroupsBusy: boolean
}

export function EnrollmentsActionsMenu({
  disabled,
  canEnrollSelfAsStudent,
  onEnrollAsStudent,
  enrollAsStudentBusy,
  onAddEnrollment,
  groupsEnabled,
  canToggleGroups,
  onEnableGroups,
  enableGroupsBusy,
}: EnrollmentsActionsMenuProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  return (
    <div ref={rootRef} className="relative inline-block w-full text-left sm:w-auto">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          if (disabled) return
          setOpen((o) => !o)
        }}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-3 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:justify-start sm:px-4"
      >
        <span>Actions</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 transition ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Enrollments actions"
          className="absolute right-0 z-50 mt-1 min-w-[14rem] overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg shadow-slate-900/10 dark:border-neutral-600 dark:bg-neutral-800 dark:shadow-black/40"
        >
          {canEnrollSelfAsStudent ? (
            <button
              type="button"
              role="menuitem"
              disabled={disabled || enrollAsStudentBusy}
              onClick={() => {
                onEnrollAsStudent()
                setOpen(false)
              }}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:text-neutral-100 dark:hover:bg-neutral-700/80"
            >
              <GraduationCap className="h-4 w-4 shrink-0" aria-hidden />
              {enrollAsStudentBusy ? 'Enrolling…' : 'Enroll as Student'}
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            disabled={disabled}
            onClick={() => {
              onAddEnrollment()
              setOpen(false)
            }}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:text-neutral-100 dark:hover:bg-neutral-700/80"
          >
            <UserPlus className="h-4 w-4 shrink-0" aria-hidden />
            Add enrollment
          </button>
          {canToggleGroups ? (
            <>
              <div className="my-1 border-t border-slate-100 dark:border-neutral-700" role="separator" />
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={groupsEnabled}
                disabled={disabled || enableGroupsBusy || groupsEnabled}
                onClick={() => {
                  if (groupsEnabled) return
                  onEnableGroups()
                  setOpen(false)
                }}
                className="flex w-full items-start gap-2 px-3 py-2.5 text-left text-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-neutral-700/80"
              >
                <span
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                    groupsEnabled
                      ? 'border-indigo-600 bg-indigo-600 text-white dark:border-indigo-500 dark:bg-indigo-500'
                      : 'border-slate-300 bg-white dark:border-neutral-500 dark:bg-neutral-800'
                  }`}
                  aria-hidden
                >
                  {groupsEnabled ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-slate-950 dark:text-neutral-100">
                    <Users className="h-4 w-4 shrink-0" aria-hidden />
                    Enable groups
                  </span>
                  <span className="text-xs text-slate-500 dark:text-neutral-400">
                    {groupsEnabled
                      ? 'Group sets and the Groups tab are on.'
                      : 'Sort students into named groups (an empty default set is created for you).'}
                  </span>
                </span>
              </button>
            </>
          ) : null}
        </div>
      )}
    </div>
  )
}
