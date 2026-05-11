/** Maps canonical enrollment role (`course.course_enrollments.role`) to badge styles. */
function enrollmentRoleBadgeClasses(courseRoleKey: string): string {
  const r = courseRoleKey.trim().toLowerCase()
  const base =
    'inline-flex max-w-full items-center truncate rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset'
  switch (r) {
    case 'owner':
      return `${base} bg-indigo-50 text-indigo-900 ring-indigo-600/20 dark:bg-indigo-950/50 dark:text-indigo-100 dark:ring-indigo-400/30`
    case 'teacher':
      return `${base} bg-indigo-50 text-indigo-800 ring-indigo-600/20 dark:bg-indigo-950/50 dark:text-indigo-100 dark:ring-indigo-400/30`
    case 'instructor':
      return `${base} bg-violet-50 text-violet-900 ring-violet-600/15 dark:bg-violet-950/40 dark:text-violet-100 dark:ring-violet-400/25`
    case 'ta':
      return `${base} bg-sky-50 text-sky-900 ring-sky-600/20 dark:bg-sky-950/40 dark:text-sky-100 dark:ring-sky-400/25`
    case 'designer':
      return `${base} bg-fuchsia-50 text-fuchsia-900 ring-fuchsia-600/15 dark:bg-fuchsia-950/40 dark:text-fuchsia-100 dark:ring-fuchsia-400/25`
    case 'observer':
      return `${base} bg-slate-100 text-slate-800 ring-slate-500/15 dark:bg-neutral-800 dark:text-neutral-100 dark:ring-neutral-500/25`
    case 'auditor':
      return `${base} bg-amber-50 text-amber-950 ring-amber-600/20 dark:bg-amber-950/35 dark:text-amber-100 dark:ring-amber-400/25`
    case 'librarian':
      return `${base} bg-emerald-50 text-emerald-900 ring-emerald-600/15 dark:bg-emerald-950/40 dark:text-emerald-100 dark:ring-emerald-400/25`
    case 'student':
      return `${base} bg-neutral-100 text-neutral-800 ring-neutral-400/20 dark:bg-neutral-800 dark:text-neutral-100 dark:ring-neutral-500/25`
    default:
      return `${base} bg-neutral-100 text-neutral-800 ring-neutral-400/20 dark:bg-neutral-800 dark:text-neutral-100 dark:ring-neutral-500/25`
  }
}

export function EnrollmentRoleBadge(props: {
  courseRoleKey: string
  /** From `enrollment_roles.display_name` when present. */
  roleDisplay?: string | null
}) {
  const key = props.courseRoleKey.trim().toLowerCase()
  const label = (props.roleDisplay ?? props.courseRoleKey).trim() || props.courseRoleKey
  return (
    <span
      className={enrollmentRoleBadgeClasses(key)}
      aria-label={`Enrollment role: ${label}`}
      title={label}
    >
      {label}
    </span>
  )
}
