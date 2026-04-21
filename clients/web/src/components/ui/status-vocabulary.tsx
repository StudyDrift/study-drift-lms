import {
  Archive,
  CalendarClock,
  CheckCircle2,
  CircleDot,
  Eye,
  EyeOff,
  FilePenLine,
  HelpCircle,
} from 'lucide-react'

const chipBase =
  'inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[0.7rem] font-semibold uppercase tracking-wide'

export function QuestionBankStatusChip({ status }: { status: string }) {
  const s = status.toLowerCase()
  if (s === 'draft') {
    return (
      <span
        className={`${chipBase} border-slate-300 bg-slate-50 text-slate-800 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100`}
        title="Status: draft (not used in live assessments)"
      >
        <FilePenLine className="h-3 w-3 shrink-0" strokeWidth={2.5} aria-hidden />
        <span>Draft</span>
        <span className="sr-only"> — shape: pen on paper</span>
      </span>
    )
  }
  if (s === 'active') {
    return (
      <span
        className={`${chipBase} border-emerald-300/80 bg-emerald-50 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-50`}
        title="Status: active (available for use)"
      >
        <CheckCircle2 className="h-3 w-3 shrink-0" strokeWidth={2.5} aria-hidden />
        <span>Active</span>
        <span className="sr-only"> — shape: checkmark in circle</span>
      </span>
    )
  }
  if (s === 'retired') {
    return (
      <span
        className={`${chipBase} border-amber-300/80 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/45 dark:text-amber-50`}
        title="Status: retired (historical only)"
      >
        <Archive className="h-3 w-3 shrink-0" strokeWidth={2.5} aria-hidden />
        <span>Retired</span>
        <span className="sr-only"> — shape: archive box</span>
      </span>
    )
  }
  return (
    <span className={`${chipBase} border-slate-200 bg-white text-slate-700 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-200`}>
      <HelpCircle className="h-3 w-3 shrink-0" aria-hidden />
      {status}
    </span>
  )
}

export function CourseVisibilityPill({
  published,
  size = 'md',
}: {
  published: boolean
  size?: 'sm' | 'md'
}) {
  const sm = size === 'sm'
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border font-semibold ${
        published
          ? 'border-emerald-300/80 bg-emerald-50 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-50'
          : 'border-slate-300 bg-slate-100 text-slate-800 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100'
      } ${sm ? 'px-1.5 py-px text-[0.65rem]' : 'px-2 py-0.5 text-xs'}`}
      title={published ? 'Published — learners can see when released' : 'Unpublished — staff only'}
    >
      {published ? (
        <Eye className={sm ? 'h-2.5 w-2.5' : 'h-3 w-3'} aria-hidden />
      ) : (
        <EyeOff className={sm ? 'h-2.5 w-2.5' : 'h-3 w-3'} aria-hidden />
      )}
      {published ? 'Pub.' : 'Off'}
      <span className="sr-only">{published ? 'Published' : 'Unpublished'}</span>
    </span>
  )
}

export function CourseCatalogStatusPill({ label }: { label: string }) {
  const key = label.toLowerCase()
  const icon =
    key === 'draft' ? (
      <FilePenLine className="h-3 w-3 shrink-0" aria-hidden />
    ) : key === 'ended' ? (
      <Archive className="h-3 w-3 shrink-0" aria-hidden />
    ) : key === 'upcoming' ? (
      <CalendarClock className="h-3 w-3 shrink-0" aria-hidden />
    ) : (
      <CircleDot className="h-3 w-3 shrink-0" aria-hidden />
    )
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-900/75 px-2 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
      {icon}
      <span>{label}</span>
    </span>
  )
}
