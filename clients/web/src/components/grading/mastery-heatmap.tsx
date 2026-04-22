/** Returns accessible cell styling for a proficiency label (not color-only: title repeats the label). */
function masteryCellVisual(levelLabel: string): { className: string; title: string } {
  const t = levelLabel.trim()
  if (t === '—' || t === '-' || t.length === 0) {
    return { className: 'bg-slate-100 text-slate-500 dark:bg-neutral-800 dark:text-neutral-500', title: t || 'Not assessed' }
  }
  const u = t.toLowerCase()
  if (u.includes('exceed')) {
    return { className: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-100', title: t }
  }
  if (u.includes('meet')) {
    return { className: 'bg-sky-100 text-sky-900 dark:bg-sky-900/50 dark:text-sky-100', title: t }
  }
  if (u.includes('approach') || u.includes('progress')) {
    return { className: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100', title: t }
  }
  if (u.includes('not')) {
    return { className: 'bg-rose-100 text-rose-900 dark:bg-rose-900/50 dark:text-rose-100', title: t }
  }
  return { className: 'bg-slate-100 text-slate-800 dark:bg-neutral-800 dark:text-neutral-200', title: t }
}

export function MasteryLabelCell({
  label,
  studentName,
  standardCode,
}: {
  label: string
  studentName: string
  standardCode: string
}) {
  const { className, title } = masteryCellVisual(label)
  return (
    <td
      className={`px-1 py-1 text-center text-xs font-medium ${className} rounded`}
      title={`${studentName}, ${standardCode}: ${title}`}
      aria-label={`${studentName}, standard ${standardCode}: ${title}`}
    >
      {label}
    </td>
  )
}
