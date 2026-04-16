import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { ChevronDown, Plus, Shuffle, Trash2, X } from 'lucide-react'
import type { CourseEnrollment } from './CourseEnrollments'
import {
  deleteEnrollmentGroup,
  deleteEnrollmentGroupSet,
  type EnrollmentGroupsTreeResponse,
  fetchEnrollmentGroupsTree,
  patchEnrollmentGroupName,
  patchEnrollmentGroupSetName,
  postEnrollmentGroupInSet,
  postEnrollmentGroupSet,
  putEnrollmentGroupMembership,
} from '../../lib/coursesApi'

/** Stacks above roster modals (`z-50`); same blurred backdrop treatment. */
const LMS_GROUPS_DIALOG_OVERLAY_CLASS =
  'fixed inset-0 z-[60] flex items-end justify-center p-4 backdrop-blur-md bg-slate-900/30 dark:bg-black/40 sm:items-center'

function dropId(setId: string, groupId: string | '__unassigned__') {
  return `drop:${setId}:${groupId}`
}

function parseDropId(id: string): { setId: string; groupId: string | null } | null {
  if (!id.startsWith('drop:')) return null
  const parts = id.split(':')
  if (parts.length < 3) return null
  const setId = parts[1]!
  const tail = parts.slice(2).join(':')
  if (tail === '__unassigned__') return { setId, groupId: null }
  return { setId, groupId: tail }
}

function DraggableChip({
  enrollmentId,
  label,
  disabled,
}: {
  enrollmentId: string
  label: string
  disabled: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `drag:${enrollmentId}`,
    data: { enrollmentId },
    disabled,
  })
  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.45 : 1,
  }
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className="cursor-grab rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 active:cursor-grabbing dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
    >
      {label}
    </div>
  )
}

function DroppableColumn({
  setId,
  groupId,
  title,
  subtitle,
  highlight,
  collapsible = false,
  expanded = true,
  onToggle,
  children,
}: {
  setId: string
  groupId: string | '__unassigned__'
  title: string
  subtitle?: string
  highlight: boolean
  collapsible?: boolean
  expanded?: boolean
  onToggle?: () => void
  children: ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: dropId(setId, groupId),
  })
  return (
    <div
      ref={setNodeRef}
      className={`flex min-w-[11rem] w-full flex-col rounded-xl border bg-slate-50/80 p-2 dark:bg-neutral-900/50 ${
        isOver || highlight
          ? 'border-indigo-400 ring-1 ring-indigo-400/40'
          : 'border-slate-200 dark:border-neutral-700'
      } ${expanded ? 'min-h-[10rem]' : 'min-h-[3.5rem]'}`}
    >
      {collapsible ? (
        <button
          type="button"
          onClick={onToggle}
          className="mb-2 flex w-full items-start justify-between gap-2 shrink-0 border-b border-slate-200 pb-2 text-left dark:border-neutral-700"
          aria-expanded={expanded}
        >
          <span>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-neutral-400">
              {title}
            </p>
            {subtitle ? (
              <p className="mt-0.5 text-[11px] text-slate-500 dark:text-neutral-500">{subtitle}</p>
            ) : null}
          </span>
          <ChevronDown
            className={`mt-0.5 h-4 w-4 shrink-0 text-slate-500 transition-transform dark:text-neutral-400 ${
              expanded ? 'rotate-0' : '-rotate-90'
            }`}
            aria-hidden
          />
        </button>
      ) : (
        <div className="mb-2 shrink-0 border-b border-slate-200 pb-2 dark:border-neutral-700">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-neutral-400">
            {title}
          </p>
          {subtitle ? (
            <p className="mt-0.5 text-[11px] text-slate-500 dark:text-neutral-500">{subtitle}</p>
          ) : null}
        </div>
      )}
      {expanded ? <div className="flex flex-col gap-1.5">{children}</div> : null}
    </div>
  )
}

type GroupSetActionsMenuProps = {
  disabled: boolean
  hasSelectedSet: boolean
  canAssignUnassigned: boolean
  onNewSet: () => void
  onRenameSet: () => void
  onDeleteSet: () => void
  onNewGroup: () => void
  onAssignUnassigned: () => void
}

function GroupSetActionsMenu({
  disabled,
  hasSelectedSet,
  canAssignUnassigned,
  onNewSet,
  onRenameSet,
  onDeleteSet,
  onNewGroup,
  onAssignUnassigned,
}: GroupSetActionsMenuProps) {
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
        <ChevronDown className={`h-4 w-4 shrink-0 transition ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label="Group set actions"
          className="absolute right-0 z-50 mt-1 min-w-[14rem] overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg shadow-slate-900/10 dark:border-neutral-600 dark:bg-neutral-800 dark:shadow-black/40"
        >
          <button
            type="button"
            role="menuitem"
            disabled={disabled}
            onClick={() => {
              onNewSet()
              setOpen(false)
            }}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:text-neutral-100 dark:hover:bg-neutral-700/80"
          >
            <Plus className="h-4 w-4 shrink-0" aria-hidden />
            New set
          </button>
          {hasSelectedSet ? (
            <>
              <button
                type="button"
                role="menuitem"
                disabled={disabled}
                onClick={() => {
                  onRenameSet()
                  setOpen(false)
                }}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:text-neutral-100 dark:hover:bg-neutral-700/80"
              >
                Rename set
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={disabled}
                onClick={() => {
                  onDeleteSet()
                  setOpen(false)
                }}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60 dark:text-rose-300 dark:hover:bg-rose-950/40"
              >
                <Trash2 className="h-4 w-4 shrink-0" aria-hidden />
                Delete set
              </button>
              <div className="my-1 border-t border-slate-100 dark:border-neutral-700" role="separator" />
              <button
                type="button"
                role="menuitem"
                disabled={disabled}
                onClick={() => {
                  onNewGroup()
                  setOpen(false)
                }}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:text-neutral-100 dark:hover:bg-neutral-700/80"
              >
                <Plus className="h-4 w-4 shrink-0" aria-hidden />
                New group
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={disabled || !canAssignUnassigned}
                onClick={() => {
                  if (!canAssignUnassigned) return
                  onAssignUnassigned()
                  setOpen(false)
                }}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:text-neutral-100 dark:hover:bg-neutral-700/80"
              >
                <Shuffle className="h-4 w-4 shrink-0" aria-hidden />
                Assign unassigned students
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

type DialogState =
  | { kind: 'closed' }
  | { kind: 'new-set'; name: string; error: string | null }
  | { kind: 'rename-set'; setId: string; name: string; error: string | null }
  | { kind: 'delete-set'; setId: string; displayName: string; error: string | null }
  | { kind: 'new-group'; name: string; error: string | null }
  | { kind: 'rename-group'; groupId: string; name: string; error: string | null }
  | { kind: 'delete-group'; groupId: string; displayName: string; error: string | null }

type Props = {
  courseCode: string
  enrollments: CourseEnrollment[]
  canEdit: boolean
}

function isStudentEnrollment(e: CourseEnrollment): boolean {
  return e.role === 'Student'
}

export function EnrollmentGroupsPanel({ courseCode, enrollments, canEdit }: Props) {
  const [tree, setTree] = useState<EnrollmentGroupsTreeResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedSetId, setSelectedSetId] = useState<string | null>(null)
  const [activeEnrollmentId, setActiveEnrollmentId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<DialogState>({ kind: 'closed' })
  const [dialogBusy, setDialogBusy] = useState(false)
  const [expandedGroupsById, setExpandedGroupsById] = useState<Record<string, boolean>>({})

  const studentEnrollments = useMemo(
    () => enrollments.filter(isStudentEnrollment),
    [enrollments],
  )

  const enrollmentById = useMemo(() => {
    const m = new Map<string, CourseEnrollment>()
    for (const e of enrollments) m.set(e.id, e)
    return m
  }, [enrollments])

  const load = useCallback(async () => {
    setLoadError(null)
    setLoading(true)
    try {
      const t = await fetchEnrollmentGroupsTree(courseCode)
      setTree(t)
      setSelectedSetId((prev) => {
        if (prev && t.groupSets.some((s) => s.id === prev)) return prev
        return t.groupSets[0]?.id ?? null
      })
    } catch (e: unknown) {
      setTree(null)
      setLoadError(e instanceof Error ? e.message : 'Could not load groups.')
    } finally {
      setLoading(false)
    }
  }, [courseCode])

  useEffect(() => {
    void load()
  }, [load])

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  )

  const selectedSet = tree?.groupSets.find((s) => s.id === selectedSetId) ?? null

  useEffect(() => {
    if (!selectedSet) return
    setExpandedGroupsById((prev) => {
      const next: Record<string, boolean> = {}
      for (const group of selectedSet.groups) {
        next[group.id] = prev[group.id] ?? true
      }
      return next
    })
  }, [selectedSet])

  const unassignedInSet = useMemo(() => {
    const inSet = new Set<string>()
    if (!selectedSet?.groups) {
      return [] as CourseEnrollment[]
    }
    for (const g of selectedSet.groups) {
      for (const eid of g.enrollmentIds) {
        inSet.add(eid)
      }
    }
    return studentEnrollments.filter((e) => !inSet.has(e.id))
  }, [selectedSet, studentEnrollments])

  const activeLabel = activeEnrollmentId
    ? enrollmentById.get(activeEnrollmentId)?.displayName?.trim() || '—'
    : ''

  const closeDialog = useCallback(() => {
    if (!dialogBusy) setDialog({ kind: 'closed' })
  }, [dialogBusy])

  useEffect(() => {
    if (dialog.kind === 'closed') return
    function onKeydown(e: globalThis.KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (dialogBusy) return
      e.preventDefault()
      setDialog({ kind: 'closed' })
    }
    window.addEventListener('keydown', onKeydown)
    return () => window.removeEventListener('keydown', onKeydown)
  }, [dialog.kind, dialogBusy])

  async function onDragEnd(ev: DragEndEvent) {
    setActionError(null)
    const enrollId = ev.active.data.current?.enrollmentId as string | undefined
    if (!enrollId || !ev.over) return
    const en = enrollmentById.get(enrollId)
    if (!en || !isStudentEnrollment(en)) return
    const parsed = parseDropId(String(ev.over.id))
    if (!parsed || parsed.setId !== selectedSetId) return
    setBusy(true)
    try {
      await putEnrollmentGroupMembership(courseCode, {
        enrollmentId: enrollId,
        groupSetId: parsed.setId,
        groupId: parsed.groupId,
      })
      await load()
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : 'Could not update group.')
    } finally {
      setBusy(false)
      setActiveEnrollmentId(null)
    }
  }

  function onDragStart(ev: DragStartEvent) {
    const id = ev.active.data.current?.enrollmentId as string | undefined
    setActiveEnrollmentId(id ?? null)
  }

  async function submitNewSet() {
    if (dialog.kind !== 'new-set') return
    const name = dialog.name.trim()
    if (!name) {
      setDialog((d) => (d.kind === 'new-set' ? { ...d, error: 'Enter a name.' } : d))
      return
    }
    setDialogBusy(true)
    setDialog((d) => (d.kind === 'new-set' ? { ...d, error: null } : d))
    try {
      const id = await postEnrollmentGroupSet(courseCode, name)
      await load()
      setSelectedSetId(id)
      setDialog({ kind: 'closed' })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Could not create group set.'
      setDialog((d) => (d.kind === 'new-set' ? { ...d, error: msg } : d))
    } finally {
      setDialogBusy(false)
    }
  }

  async function submitRenameSet() {
    if (dialog.kind !== 'rename-set') return
    const name = dialog.name.trim()
    if (!name) {
      setDialog((d) => (d.kind === 'rename-set' ? { ...d, error: 'Enter a name.' } : d))
      return
    }
    setDialogBusy(true)
    setDialog((d) => (d.kind === 'rename-set' ? { ...d, error: null } : d))
    try {
      await patchEnrollmentGroupSetName(courseCode, dialog.setId, name)
      await load()
      setDialog({ kind: 'closed' })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Could not rename.'
      setDialog((d) => (d.kind === 'rename-set' ? { ...d, error: msg } : d))
    } finally {
      setDialogBusy(false)
    }
  }

  async function submitDeleteSet() {
    if (dialog.kind !== 'delete-set') return
    setDialogBusy(true)
    setDialog((d) => (d.kind === 'delete-set' ? { ...d, error: null } : d))
    try {
      await deleteEnrollmentGroupSet(courseCode, dialog.setId)
      await load()
      setDialog({ kind: 'closed' })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Could not delete group set.'
      setDialog((d) => (d.kind === 'delete-set' ? { ...d, error: msg } : d))
    } finally {
      setDialogBusy(false)
    }
  }

  async function submitNewGroup() {
    if (dialog.kind !== 'new-group' || !selectedSetId) return
    const name = dialog.name.trim()
    if (!name) {
      setDialog((d) => (d.kind === 'new-group' ? { ...d, error: 'Enter a name.' } : d))
      return
    }
    setDialogBusy(true)
    setDialog((d) => (d.kind === 'new-group' ? { ...d, error: null } : d))
    try {
      await postEnrollmentGroupInSet(courseCode, selectedSetId, name)
      await load()
      setDialog({ kind: 'closed' })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Could not create group.'
      setDialog((d) => (d.kind === 'new-group' ? { ...d, error: msg } : d))
    } finally {
      setDialogBusy(false)
    }
  }

  async function submitRenameGroup() {
    if (dialog.kind !== 'rename-group') return
    const name = dialog.name.trim()
    if (!name) {
      setDialog((d) => (d.kind === 'rename-group' ? { ...d, error: 'Enter a name.' } : d))
      return
    }
    setDialogBusy(true)
    setDialog((d) => (d.kind === 'rename-group' ? { ...d, error: null } : d))
    try {
      await patchEnrollmentGroupName(courseCode, dialog.groupId, name)
      await load()
      setDialog({ kind: 'closed' })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Could not rename.'
      setDialog((d) => (d.kind === 'rename-group' ? { ...d, error: msg } : d))
    } finally {
      setDialogBusy(false)
    }
  }

  async function submitDeleteGroup() {
    if (dialog.kind !== 'delete-group') return
    setDialogBusy(true)
    setDialog((d) => (d.kind === 'delete-group' ? { ...d, error: null } : d))
    try {
      await deleteEnrollmentGroup(courseCode, dialog.groupId)
      await load()
      setDialog({ kind: 'closed' })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Could not delete group.'
      setDialog((d) => (d.kind === 'delete-group' ? { ...d, error: msg } : d))
    } finally {
      setDialogBusy(false)
    }
  }

  async function submitAssignUnassignedToGroups() {
    if (!selectedSetId || !selectedSet?.groups.length || !unassignedInSet.length) return
    setActionError(null)
    setBusy(true)
    try {
      for (let i = 0; i < unassignedInSet.length; i += 1) {
        const enrollment = unassignedInSet[i]
        if (!enrollment) continue
        const targetGroup = selectedSet.groups[i % selectedSet.groups.length]
        if (!targetGroup) continue
        await putEnrollmentGroupMembership(courseCode, {
          enrollmentId: enrollment.id,
          groupSetId: selectedSetId,
          groupId: targetGroup.id,
        })
      }
      await load()
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : 'Could not assign unassigned students.')
    } finally {
      setBusy(false)
    }
  }

  if (loading && !tree) {
    return <p className="mt-4 text-sm text-slate-500 dark:text-neutral-400">Loading groups…</p>
  }

  if (loadError) {
    return (
      <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-200">
        {loadError}
      </p>
    )
  }

  if (!tree?.groupSets.length) {
    return (
      <div className="mt-6">
        <p className="text-sm text-slate-600 dark:text-neutral-400">
          No group sets yet. Use &quot;New group set&quot; to create one.
        </p>
        {canEdit ? (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              setDialog({ kind: 'new-set', name: 'New group set', error: null })
            }
            className="mt-4 inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm hover:border-indigo-200 hover:bg-indigo-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:border-indigo-500/40 dark:hover:bg-neutral-800"
          >
            <Plus className="h-4 w-4" aria-hidden />
            New group set
          </button>
        ) : null}
        {dialog.kind !== 'closed' ? (
          <GroupsDialog
            dialog={dialog}
            dialogBusy={dialogBusy}
            onClose={closeDialog}
            onDialogChange={setDialog}
            onSubmitNewSet={() => void submitNewSet()}
            onSubmitRenameSet={() => void submitRenameSet()}
            onSubmitDeleteSet={() => void submitDeleteSet()}
            onSubmitNewGroup={() => void submitNewGroup()}
            onSubmitRenameGroup={() => void submitRenameGroup()}
            onSubmitDeleteGroup={() => void submitDeleteGroup()}
          />
        ) : null}
      </div>
    )
  }

  return (
    <div className="mt-6">
      {actionError ? (
        <p className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-200">
          {actionError}
        </p>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[12rem] flex-1">
          <label htmlFor="enrollment-group-set" className="text-xs font-medium text-slate-600 dark:text-neutral-400">
            Group set
          </label>
          <select
            id="enrollment-group-set"
            value={selectedSetId ?? ''}
            onChange={(e) => setSelectedSetId(e.target.value || null)}
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-indigo-500/20 focus:border-indigo-400 focus:ring-2 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
          >
            {tree.groupSets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        {canEdit ? (
          <GroupSetActionsMenu
            disabled={busy}
            hasSelectedSet={Boolean(selectedSetId)}
            canAssignUnassigned={Boolean(selectedSet?.groups.length && unassignedInSet.length)}
            onNewSet={() => setDialog({ kind: 'new-set', name: 'New group set', error: null })}
            onRenameSet={() => {
              if (!selectedSetId) return
              setDialog({
                kind: 'rename-set',
                setId: selectedSetId,
                name: selectedSet?.name ?? '',
                error: null,
              })
            }}
            onDeleteSet={() => {
              if (!selectedSetId) return
              setDialog({
                kind: 'delete-set',
                setId: selectedSetId,
                displayName: selectedSet?.name ?? 'this group set',
                error: null,
              })
            }}
            onNewGroup={() => setDialog({ kind: 'new-group', name: 'New group', error: null })}
            onAssignUnassigned={() => void submitAssignUnassignedToGroups()}
          />
        ) : null}
      </div>

      {selectedSet && selectedSetId ? (
        <DndContext
          sensors={sensors}
          collisionDetection={pointerWithin}
          onDragStart={onDragStart}
          onDragEnd={(e) => void onDragEnd(e)}
          onDragCancel={() => setActiveEnrollmentId(null)}
        >
          <div className="mt-6 overflow-x-auto">
            <div className="grid min-w-full gap-3 lg:grid-cols-[minmax(15rem,22rem)_minmax(0,1fr)]">
            <div className="lg:sticky lg:top-4 lg:self-start">
              <DroppableColumn
                setId={selectedSetId}
                groupId="__unassigned__"
                title="Unassigned"
                subtitle="Students only. Drag into a group to assign, or here to unassign."
                highlight={false}
              >
                {unassignedInSet.map((e) => (
                  <DraggableChip
                    key={e.id}
                    enrollmentId={e.id}
                    label={e.displayName?.trim() || '—'}
                    disabled={!canEdit || busy}
                  />
                ))}
              </DroppableColumn>
            </div>
            <div className="flex min-w-max flex-col gap-3">
              {selectedSet.groups.map((g) => {
                const expanded = expandedGroupsById[g.id] ?? true
                return (
                  <DroppableColumn
                    key={g.id}
                    setId={selectedSetId}
                    groupId={g.id}
                    title={g.name}
                    subtitle={canEdit ? 'Rename or delete with the links below.' : undefined}
                    highlight={false}
                    collapsible
                    expanded={expanded}
                    onToggle={() =>
                      setExpandedGroupsById((prev) => ({ ...prev, [g.id]: !(prev[g.id] ?? true) }))
                    }
                  >
                    <div className="mb-1 flex flex-wrap gap-1">
                      {canEdit ? (
                        <>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              setDialog({
                                kind: 'rename-group',
                                groupId: g.id,
                                name: g.name,
                                error: null,
                              })
                            }
                            className="rounded-lg px-2 py-1 text-[11px] font-medium text-indigo-700 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950/40"
                          >
                            Rename
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              setDialog({
                                kind: 'delete-group',
                                groupId: g.id,
                                displayName: g.name,
                                error: null,
                              })
                            }
                            className="rounded-lg px-2 py-1 text-[11px] font-medium text-rose-700 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/40"
                          >
                            Delete
                          </button>
                        </>
                      ) : null}
                    </div>
                    {g.enrollmentIds.map((eid) => {
                      const e = enrollmentById.get(eid)
                      const label = e?.displayName?.trim() || '—'
                      const isStudent = e ? isStudentEnrollment(e) : false
                      if (!isStudent) return null
                      return (
                        <DraggableChip
                          key={eid}
                          enrollmentId={eid}
                          label={label}
                          disabled={!canEdit || busy}
                        />
                      )
                    })}
                  </DroppableColumn>
                )
              })}
            </div>
          </div>
          </div>
          <DragOverlay dropAnimation={null}>
            {activeEnrollmentId ? (
              <div className="cursor-grabbing rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-medium text-indigo-950 shadow-md dark:border-indigo-500/40 dark:bg-indigo-950/80 dark:text-indigo-100">
                {activeLabel}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      ) : null}

      {!canEdit ? (
        <p className="mt-4 text-xs text-slate-500 dark:text-neutral-500">
          You can view groups but only people with roster edit access can change them.
        </p>
      ) : null}

      {dialog.kind !== 'closed' ? (
        <GroupsDialog
          dialog={dialog}
          dialogBusy={dialogBusy}
          onClose={closeDialog}
          onDialogChange={setDialog}
          onSubmitNewSet={() => void submitNewSet()}
          onSubmitRenameSet={() => void submitRenameSet()}
          onSubmitDeleteSet={() => void submitDeleteSet()}
          onSubmitNewGroup={() => void submitNewGroup()}
          onSubmitRenameGroup={() => void submitRenameGroup()}
          onSubmitDeleteGroup={() => void submitDeleteGroup()}
        />
      ) : null}
    </div>
  )
}

function GroupsDialog({
  dialog,
  dialogBusy,
  onClose,
  onDialogChange,
  onSubmitNewSet,
  onSubmitRenameSet,
  onSubmitDeleteSet,
  onSubmitNewGroup,
  onSubmitRenameGroup,
  onSubmitDeleteGroup,
}: {
  dialog: DialogState
  dialogBusy: boolean
  onClose: () => void
  onDialogChange: (d: DialogState) => void
  onSubmitNewSet: () => void
  onSubmitRenameSet: () => void
  onSubmitDeleteSet: () => void
  onSubmitNewGroup: () => void
  onSubmitRenameGroup: () => void
  onSubmitDeleteGroup: () => void
}) {
  if (dialog.kind === 'closed') return null

  const shouldSubmitOnEnter =
    dialog.kind === 'new-set' ||
    dialog.kind === 'rename-set' ||
    dialog.kind === 'new-group' ||
    dialog.kind === 'rename-group'

  function onInputKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!shouldSubmitOnEnter) return
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (dialogBusy) return
    primaryAction()
  }

  let title = ''
  let body: ReactNode = null
  let primaryLabel = 'Save'
  let primaryAction: () => void = onClose
  let primaryVariant: 'danger' | 'primary' = 'primary'

  if (dialog.kind === 'new-set') {
    title = 'New group set'
    primaryLabel = 'Create'
    primaryAction = onSubmitNewSet
    body = (
      <>
        <label htmlFor="dlg-new-set-name" className="text-xs font-medium text-slate-600 dark:text-neutral-400">
          Name
        </label>
        <input
          id="dlg-new-set-name"
          type="text"
          autoFocus
          value={dialog.name}
          onChange={(e) =>
            onDialogChange({ kind: 'new-set', name: e.target.value, error: null })
          }
          className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-indigo-500/20 focus:border-indigo-400 focus:ring-2 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
          disabled={dialogBusy}
          onKeyDown={onInputKeyDown}
        />
      </>
    )
  } else if (dialog.kind === 'rename-set') {
    title = 'Rename group set'
    primaryLabel = 'Save'
    primaryAction = onSubmitRenameSet
    body = (
      <>
        <label htmlFor="dlg-rename-set-name" className="text-xs font-medium text-slate-600 dark:text-neutral-400">
          Name
        </label>
        <input
          id="dlg-rename-set-name"
          type="text"
          autoFocus
          value={dialog.name}
          onChange={(e) =>
            onDialogChange({
              kind: 'rename-set',
              setId: dialog.setId,
              name: e.target.value,
              error: null,
            })
          }
          className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-indigo-500/20 focus:border-indigo-400 focus:ring-2 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
          disabled={dialogBusy}
          onKeyDown={onInputKeyDown}
        />
      </>
    )
  } else if (dialog.kind === 'delete-set') {
    title = 'Delete group set?'
    primaryLabel = 'Delete group set'
    primaryVariant = 'danger'
    primaryAction = onSubmitDeleteSet
    body = (
      <p className="text-sm text-slate-600 dark:text-neutral-400">
        This will remove <span className="font-semibold text-slate-900 dark:text-neutral-100">{dialog.displayName}</span>{' '}
        and every group inside it. Student memberships in this set will be cleared. This cannot be undone.
      </p>
    )
  } else if (dialog.kind === 'new-group') {
    title = 'New group'
    primaryLabel = 'Create'
    primaryAction = onSubmitNewGroup
    body = (
      <>
        <label htmlFor="dlg-new-group-name" className="text-xs font-medium text-slate-600 dark:text-neutral-400">
          Name
        </label>
        <input
          id="dlg-new-group-name"
          type="text"
          autoFocus
          value={dialog.name}
          onChange={(e) =>
            onDialogChange({ kind: 'new-group', name: e.target.value, error: null })
          }
          className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-indigo-500/20 focus:border-indigo-400 focus:ring-2 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
          disabled={dialogBusy}
          onKeyDown={onInputKeyDown}
        />
      </>
    )
  } else if (dialog.kind === 'rename-group') {
    title = 'Rename group'
    primaryLabel = 'Save'
    primaryAction = onSubmitRenameGroup
    body = (
      <>
        <label htmlFor="dlg-rename-group-name" className="text-xs font-medium text-slate-600 dark:text-neutral-400">
          Name
        </label>
        <input
          id="dlg-rename-group-name"
          type="text"
          autoFocus
          value={dialog.name}
          onChange={(e) =>
            onDialogChange({
              kind: 'rename-group',
              groupId: dialog.groupId,
              name: e.target.value,
              error: null,
            })
          }
          className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-indigo-500/20 focus:border-indigo-400 focus:ring-2 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
          disabled={dialogBusy}
          onKeyDown={onInputKeyDown}
        />
      </>
    )
  } else if (dialog.kind === 'delete-group') {
    title = 'Delete group?'
    primaryLabel = 'Delete group'
    primaryVariant = 'danger'
    primaryAction = onSubmitDeleteGroup
    body = (
      <p className="text-sm text-slate-600 dark:text-neutral-400">
        Remove <span className="font-semibold text-slate-900 dark:text-neutral-100">{dialog.displayName}</span>? Students
        in this group become unassigned for this set.
      </p>
    )
  }

  const err = dialog.error ?? null

  return (
    <div
      className={LMS_GROUPS_DIALOG_OVERLAY_CLASS}
      role="dialog"
      aria-modal="true"
      aria-labelledby="enrollment-groups-dlg-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !dialogBusy) onClose()
      }}
    >
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-neutral-700">
          <h2 id="enrollment-groups-dlg-title" className="text-sm font-semibold text-slate-900 dark:text-neutral-100">
            {title}
          </h2>
          <button
            type="button"
            onClick={() => onClose()}
            disabled={dialogBusy}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50 dark:text-neutral-400 dark:hover:bg-neutral-800"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-4">
          {body}
          {err ? (
            <p className="mt-3 text-sm text-rose-700 dark:text-rose-300" role="alert">
              {err}
            </p>
          ) : null}
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => onClose()}
              disabled={dialogBusy}
              className="rounded-xl px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => primaryAction()}
              disabled={dialogBusy}
              className={
                primaryVariant === 'danger'
                  ? 'rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-60'
                  : 'rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60'
              }
            >
              {dialogBusy ? 'Working…' : primaryLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
