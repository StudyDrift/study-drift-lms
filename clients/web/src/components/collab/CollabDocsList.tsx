import { useState } from 'react'
import { Link } from 'react-router-dom'
import { FileText, LayoutTemplate, Plus, Trash2 } from 'lucide-react'
import type { CollabDoc, DocType } from '../../lib/collab-docs-api'
import { createCollabDoc, deleteCollabDoc } from '../../lib/collab-docs-api'
import { toastMutationError } from '../../lib/lms-toast'

type Props = {
  courseCode: string
  docs: CollabDoc[]
  canManage: boolean
  onDocsChanged: () => void
}

export function CollabDocsList({ courseCode, docs, canManage, onDocsChanged }: Props) {
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newType, setNewType] = useState<DocType>('rich_text')
  const [submitting, setSubmitting] = useState(false)

  const base = `/courses/${encodeURIComponent(courseCode)}/collab-docs`

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!newTitle.trim()) return
    setSubmitting(true)
    try {
      await createCollabDoc(courseCode, newTitle.trim(), newType)
      setNewTitle('')
      setCreating(false)
      onDocsChanged()
    } catch (err) {
      toastMutationError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(docId: string) {
    if (!window.confirm('Delete this document? This cannot be undone.')) return
    try {
      await deleteCollabDoc(courseCode, docId)
      onDocsChanged()
    } catch (err) {
      toastMutationError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-slate-900 dark:text-neutral-100">
          Collaborative Documents
        </h2>
        {canManage && !creating && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            New document
          </button>
        )}
      </div>

      {creating && (
        <form
          onSubmit={(e) => { void handleCreate(e) }}
          className="rounded-lg border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-800 dark:bg-indigo-950/30"
        >
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-neutral-300" htmlFor="doc-title">
                Document title
              </label>
              <input
                id="doc-title"
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="My collaborative document"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
                autoFocus
              />
            </div>
            <div>
              <span className="block text-sm font-medium text-slate-700 dark:text-neutral-300">
                Document type
              </span>
              <div className="mt-1 flex gap-4">
                <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-neutral-300">
                  <input
                    type="radio"
                    name="doc-type"
                    value="rich_text"
                    checked={newType === 'rich_text'}
                    onChange={() => setNewType('rich_text')}
                  />
                  Rich text
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-neutral-300">
                  <input
                    type="radio"
                    name="doc-type"
                    value="whiteboard"
                    checked={newType === 'whiteboard'}
                    onChange={() => setNewType('whiteboard')}
                  />
                  Whiteboard
                </label>
              </div>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button
              type="submit"
              disabled={submitting || !newTitle.trim()}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              {submitting ? 'Creating…' : 'Create'}
            </button>
            <button
              type="button"
              onClick={() => { setCreating(false); setNewTitle('') }}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {docs.length === 0 && !creating && (
        <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center dark:border-neutral-600">
          <FileText className="mx-auto h-8 w-8 text-slate-400 dark:text-neutral-500" />
          <p className="mt-2 text-sm text-slate-500 dark:text-neutral-400">
            No collaborative documents yet.
          </p>
          {canManage && (
            <p className="text-sm text-slate-400 dark:text-neutral-500">
              Click <strong>New document</strong> to create one.
            </p>
          )}
        </div>
      )}

      <ul className="space-y-2" role="list">
        {docs.map((doc) => (
          <li
            key={doc.id}
            className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm hover:bg-slate-50 dark:border-neutral-700 dark:bg-neutral-800/50 dark:hover:bg-neutral-700/50"
          >
            <Link
              to={`${base}/${doc.id}`}
              className="flex min-w-0 flex-1 items-center gap-3"
            >
              {doc.docType === 'whiteboard' ? (
                <LayoutTemplate className="h-5 w-5 shrink-0 text-indigo-500" aria-hidden="true" />
              ) : (
                <FileText className="h-5 w-5 shrink-0 text-indigo-500" aria-hidden="true" />
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-900 dark:text-neutral-100">
                  {doc.title}
                </p>
                <p className="text-xs text-slate-400 dark:text-neutral-500">
                  {doc.docType === 'whiteboard' ? 'Whiteboard' : 'Rich text'} ·{' '}
                  {new Date(doc.updatedAt).toLocaleDateString()}
                </p>
              </div>
            </Link>
            {canManage && (
              <button
                type="button"
                onClick={() => { void handleDelete(doc.id) }}
                aria-label={`Delete "${doc.title}"`}
                className="ml-4 rounded p-1 text-slate-400 hover:text-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:text-neutral-500 dark:hover:text-red-400"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
