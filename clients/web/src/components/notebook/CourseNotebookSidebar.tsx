import { useCallback, useMemo, useState, type ReactNode } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { FileText, GripVertical, Plus, Trash2 } from 'lucide-react'
import {
  type CourseNotebookPage,
  reparentPage,
  reorderAmongSiblings,
  sortedChildren,
} from '../../lib/courseNotebookTree'

const PARENT_ROOT = '__root__'

function parentKey(parentId: string | null): string {
  return parentId ?? PARENT_ROOT
}

type NotebookTreeRowProps = {
  page: CourseNotebookPage
  depth: number
  selectedId: string | null
  onSelect: (id: string) => void
  editingId: string | null
  draftTitle: string
  onDraftTitle: (v: string) => void
  onCommitTitle: (id: string) => void
  onStartRename: (id: string, title: string) => void
  onCancelRename: () => void
  onAddChild: (parentId: string) => void
  onDelete: (id: string) => void
  childrenBlock: ReactNode
}

function NotebookTreeRow({
  page,
  depth,
  selectedId,
  onSelect,
  editingId,
  draftTitle,
  onDraftTitle,
  onCommitTitle,
  onStartRename,
  onCancelRename,
  onAddChild,
  onDelete,
  childrenBlock,
}: NotebookTreeRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: page.id,
    data: { notebookParent: parentKey(page.parentId) },
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.55 : undefined,
  }
  const isSelected = selectedId === page.id
  const isEditing = editingId === page.id

  return (
    <li ref={setNodeRef} style={style} className="list-none">
      <div
        className={`group flex items-center gap-0.5 rounded-lg pr-1 transition ${
          isSelected ? 'bg-indigo-50 dark:bg-indigo-950/50' : 'hover:bg-slate-100 dark:hover:bg-neutral-800/80'
        }`}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
      >
        <button
          type="button"
          className="mt-0.5 flex h-8 w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-md border-0 bg-transparent p-0 text-slate-400 hover:text-slate-600 active:cursor-grabbing dark:text-neutral-500 dark:hover:text-neutral-300"
          aria-label={`Drag to reorder ${page.title}`}
          {...listeners}
          {...attributes}
        >
          <GripVertical className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => onSelect(page.id)}
          onDoubleClick={(e) => {
            e.preventDefault()
            onStartRename(page.id, page.title)
          }}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md py-1.5 text-left text-sm outline-none ring-indigo-500/30 focus-visible:ring-2"
        >
          <FileText className="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-neutral-500" aria-hidden />
          {isEditing ? (
            <input
              autoFocus
              value={draftTitle}
              onChange={(e) => onDraftTitle(e.target.value)}
              onBlur={() => onCommitTitle(page.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  onCommitTitle(page.id)
                }
                if (e.key === 'Escape') onCancelRename()
              }}
              className="min-w-0 flex-1 rounded border border-indigo-200 bg-white px-1.5 py-0.5 text-sm dark:border-indigo-800 dark:bg-neutral-900"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="min-w-0 flex-1 truncate font-medium text-slate-800 dark:text-neutral-100">
              {page.title || 'Untitled'}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onAddChild(page.id)
          }}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 opacity-0 transition hover:bg-white hover:text-indigo-600 group-hover:opacity-100 dark:hover:bg-neutral-800 dark:hover:text-indigo-300"
          aria-label={`Add subpage under ${page.title}`}
          title="Add subpage"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onDelete(page.id)
          }}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 opacity-0 transition hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100 dark:hover:bg-rose-950/40 dark:hover:text-rose-300"
          aria-label={`Delete ${page.title}`}
          title="Delete page"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      {childrenBlock}
    </li>
  )
}

type NotebookBranchProps = {
  parentId: string | null
  depth: number
  pages: CourseNotebookPage[]
  selectedId: string | null
  onSelect: (id: string) => void
  editingId: string | null
  draftTitle: string
  onDraftTitle: (v: string) => void
  onCommitTitle: (id: string) => void
  onStartRename: (id: string, title: string) => void
  onCancelRename: () => void
  onAddChild: (parentId: string) => void
  onDelete: (id: string) => void
}

function NotebookBranch({
  parentId,
  depth,
  pages,
  selectedId,
  onSelect,
  editingId,
  draftTitle,
  onDraftTitle,
  onCommitTitle,
  onStartRename,
  onCancelRename,
  onAddChild,
  onDelete,
}: NotebookBranchProps) {
  const children = sortedChildren(pages, parentId)
  if (children.length === 0) return null
  const ids = children.map((c) => c.id)
  const ctxId = `nb-${parentKey(parentId)}`

  return (
    <SortableContext id={ctxId} items={ids} strategy={verticalListSortingStrategy}>
      <ul className="mt-0.5 flex flex-col gap-0.5 pb-1">
        {children.map((page) => (
          <NotebookTreeRow
            key={page.id}
            page={page}
            depth={depth}
            selectedId={selectedId}
            onSelect={onSelect}
            editingId={editingId}
            draftTitle={draftTitle}
            onDraftTitle={onDraftTitle}
            onCommitTitle={onCommitTitle}
            onStartRename={onStartRename}
            onCancelRename={onCancelRename}
            onAddChild={onAddChild}
            onDelete={onDelete}
            childrenBlock={
              <NotebookBranch
                parentId={page.id}
                depth={depth + 1}
                pages={pages}
                selectedId={selectedId}
                onSelect={onSelect}
                editingId={editingId}
                draftTitle={draftTitle}
                onDraftTitle={onDraftTitle}
                onCommitTitle={onCommitTitle}
                onStartRename={onStartRename}
                onCancelRename={onCancelRename}
                onAddChild={onAddChild}
                onDelete={onDelete}
              />
            }
          />
        ))}
      </ul>
    </SortableContext>
  )
}

type CourseNotebookSidebarProps = {
  pages: CourseNotebookPage[]
  selectedId: string | null
  onSelect: (id: string) => void
  onPagesChange: (next: CourseNotebookPage[]) => void
  onAddRootPage: () => void
  onAddChildPage: (parentId: string) => void
  onRenamePage: (pageId: string, title: string) => void
  onDeletePage: (pageId: string) => void
}

export function CourseNotebookSidebar({
  pages,
  selectedId,
  onSelect,
  onPagesChange,
  onAddRootPage,
  onAddChildPage,
  onRenamePage,
  onDeletePage,
}: CourseNotebookSidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over) return
      const activeId = String(active.id)
      const overId = String(over.id)
      if (activeId === overId) return

      const activeParentRaw = active.data.current?.notebookParent as string | undefined
      const overParentRaw = over.data.current?.notebookParent as string | undefined
      const activeParent = activeParentRaw === PARENT_ROOT ? null : activeParentRaw ?? null
      const overParent = overParentRaw === PARENT_ROOT ? null : overParentRaw ?? null

      if (activeParent === overParent) {
        onPagesChange(reorderAmongSiblings(pages, activeParent, activeId, overId))
        return
      }

      const next = reparentPage(pages, activeId, overParent, overId)
      if (next) onPagesChange(next)
    },
    [onPagesChange, pages],
  )

  const startRename = useCallback((id: string, title: string) => {
    setEditingId(id)
    setDraftTitle(title)
    onSelect(id)
  }, [onSelect])

  const commitRename = useCallback(
    (id: string) => {
      if (editingId !== id) return
      onRenamePage(id, draftTitle.trim() || 'Untitled')
      setEditingId(null)
      setDraftTitle('')
    },
    [draftTitle, editingId, onRenamePage],
  )

  const cancelRename = useCallback(() => {
    setEditingId(null)
    setDraftTitle('')
  }, [])

  const rootHasPages = useMemo(() => pages.some((p) => p.parentId === null), [pages])

  return (
    <div className="flex h-full min-h-0 w-[min(17rem,42vw)] shrink-0 flex-col border-r border-slate-200 bg-slate-50/90 dark:border-neutral-800 dark:bg-neutral-950/80">
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2.5 dark:border-neutral-800">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-neutral-400">
          Pages
        </span>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-2" aria-label="Notebook pages">
          {rootHasPages ? (
            <NotebookBranch
              parentId={null}
              depth={0}
              pages={pages}
              selectedId={selectedId}
              onSelect={onSelect}
              editingId={editingId}
              draftTitle={draftTitle}
              onDraftTitle={setDraftTitle}
              onCommitTitle={commitRename}
              onStartRename={startRename}
              onCancelRename={cancelRename}
              onAddChild={onAddChildPage}
              onDelete={onDeletePage}
            />
          ) : (
            <p className="px-2 py-3 text-xs text-slate-500 dark:text-neutral-400">No pages yet.</p>
          )}
        </nav>
      </DndContext>
      <div className="border-t border-slate-200 p-2 dark:border-neutral-800">
        <button
          type="button"
          onClick={onAddRootPage}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm font-medium text-slate-600 transition hover:bg-white hover:text-indigo-700 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-indigo-200"
        >
          <Plus className="h-4 w-4 shrink-0" aria-hidden />
          New page
        </button>
      </div>
    </div>
  )
}
