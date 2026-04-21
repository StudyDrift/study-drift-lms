import type { SubmissionAnnotationApi } from '../../lib/courses-api'

export type AnnotationCommentPanelProps = {
  annotations: SubmissionAnnotationApi[]
  selectedId: string | null
  onSelect: (id: string) => void
  readOnly?: boolean
  onDelete?: (id: string) => void
}

export function AnnotationCommentPanel({
  annotations,
  selectedId,
  onSelect,
  readOnly,
  onDelete,
}: AnnotationCommentPanelProps) {
  return (
    <aside
      aria-label="Annotation comments"
      className="flex max-h-[70vh] w-full max-w-sm flex-col rounded-xl border border-slate-200 bg-white shadow-sm dark:border-neutral-700 dark:bg-neutral-950 lg:max-h-none"
    >
      <div className="border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800 dark:border-neutral-700 dark:text-neutral-100">
        Comments
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {annotations.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-slate-500 dark:text-neutral-400">
            No annotations yet — use the toolbar above to add feedback.
          </p>
        ) : (
          <ul className="space-y-2">
            {annotations.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => onSelect(a.id)}
                  className={`w-full rounded-lg border px-2 py-2 text-left text-xs transition ${
                    selectedId === a.id
                      ? 'border-indigo-500 bg-indigo-50 dark:border-indigo-400 dark:bg-indigo-950/40'
                      : 'border-slate-200 hover:bg-slate-50 dark:border-neutral-700 dark:hover:bg-neutral-900'
                  }`}
                >
                  <div className="font-semibold text-slate-800 dark:text-neutral-100">
                    Page {a.page} · {a.toolType}
                  </div>
                  {a.body ? (
                    <div className="mt-1 line-clamp-4 text-slate-600 dark:text-neutral-300">{a.body}</div>
                  ) : (
                    <div className="mt-1 italic text-slate-400 dark:text-neutral-500">No comment text</div>
                  )}
                </button>
                {!readOnly && onDelete ? (
                  <button
                    type="button"
                    className="mt-1 w-full rounded-md border border-rose-200 px-2 py-1 text-[11px] font-medium text-rose-700 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950/40"
                    onClick={() => onDelete(a.id)}
                  >
                    Delete
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}
