import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  GripVertical,
  MoreVertical,
  Settings,
  Sparkles,
  X,
} from 'lucide-react'
import { AddCourseItemMenu } from './AddCourseItemMenu'
import { AddModuleItemMenu, type ModuleItemKind } from './AddModuleItemMenu'
import { LmsPage } from './LmsPage'
import { ModuleExternalLinkModal } from './ModuleExternalLinkModal'
import { ModuleNameModal } from './ModuleNameModal'
import { ModuleSettingsModal } from './ModuleSettingsModal'
import { usePermissions } from '../../context/usePermissions'
import {
  createCourseModule,
  createModuleAssignment,
  createModuleContentPage,
  createModuleHeading,
  archiveCourseStructureItem,
  createModuleExternalLink,
  createModuleQuiz,
  fetchCourseStructure,
  patchCourseModule,
  patchCourseStructureItem,
  reorderCourseStructure,
  type CourseStructureItem,
} from '../../lib/coursesApi'
import { useCourseViewAs } from '../../lib/courseViewAs'
import { permCourseItemCreate } from '../../lib/rbacApi'
import { formatDueShort } from '../../lib/courseCalendarUtils'

const MODULE_SORT_ID = 'sortable-modules'

/** Quiet icon-only controls (no box borders) for module + item toolbars. */
const iconGhost =
  'rounded-md p-2.5 text-slate-500 transition hover:bg-slate-200/45 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-50 sm:p-1.5 dark:text-neutral-400 dark:hover:bg-neutral-700/35 dark:hover:text-neutral-200'
const iconGhostPublished =
  'rounded-md p-2.5 text-indigo-600 transition hover:bg-indigo-50/90 hover:text-indigo-700 disabled:cursor-not-allowed disabled:opacity-50 sm:p-1.5 dark:text-indigo-400 dark:hover:bg-indigo-950/45 dark:hover:text-indigo-300'
const iconGhostDraft =
  'rounded-md p-2.5 text-slate-400 transition hover:bg-slate-200/45 hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-50 sm:p-1.5 dark:text-neutral-500 dark:hover:bg-neutral-700/35 dark:hover:text-neutral-300'

function findModuleIdForChildItem(
  childId: string,
  moduleChildrenById: Map<string, CourseStructureItem[]>,
): string | undefined {
  for (const [mid, list] of moduleChildrenById) {
    if (list.some((c) => c.id === childId)) return mid
  }
  return undefined
}

function buildReorderPayloadFromItems(items: CourseStructureItem[]): {
  moduleOrder: string[]
  childOrderByModule: Record<string, string[]>
} {
  const modules = items
    .filter((i) => i.kind === 'module' && !i.parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder)
  const moduleOrder = modules.map((m) => m.id)
  const childOrderByModule: Record<string, string[]> = {}
  for (const m of modules) {
    childOrderByModule[m.id] = items
      .filter(
        (i) =>
          i.parentId === m.id &&
          (i.kind === 'heading' ||
            i.kind === 'content_page' ||
            i.kind === 'assignment' ||
            i.kind === 'quiz' ||
            i.kind === 'external_link'),
      )
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((c) => c.id)
  }
  return { moduleOrder, childOrderByModule }
}

const moduleChildMetaLineClasses =
  'mt-0.5 text-xs font-normal leading-snug text-slate-500 dark:text-neutral-400'

function formatPtsLabel(n: number): string {
  return n === 1 ? '1 pt' : `${n} pts`
}

/** Gradebook points if set; otherwise traditional quiz question total. */
function structureItemPointsLabel(child: CourseStructureItem): string | null {
  if (typeof child.pointsWorth === 'number') {
    return formatPtsLabel(child.pointsWorth)
  }
  if (child.kind === 'quiz' && !child.isAdaptive && typeof child.pointsPossible === 'number') {
    return formatPtsLabel(child.pointsPossible)
  }
  return null
}

function moduleChildItemMetaLine(child: CourseStructureItem): string | null {
  const parts: string[] = []
  const pts = structureItemPointsLabel(child)
  if (pts) parts.push(pts)
  if (
    child.dueAt &&
    (child.kind === 'content_page' ||
      child.kind === 'assignment' ||
      child.kind === 'quiz' ||
      child.kind === 'heading')
  ) {
    parts.push(`Due ${formatDueShort(child.dueAt)}`)
  }
  if (parts.length === 0) return null
  return parts.join(' · ')
}

function ChildRowContent({ child, courseCode }: { child: CourseStructureItem; courseCode: string }) {
  const meta = moduleChildItemMetaLine(child)
  return (
    <>
      {child.kind === 'content_page' ? (
        <div className="flex items-start gap-3">
          <span
            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-indigo-200/80 bg-indigo-50 text-indigo-600 dark:border-indigo-500/35 dark:bg-indigo-950/60 dark:text-indigo-300"
            aria-hidden
          >
            <FileText className="h-4 w-4" strokeWidth={2} />
          </span>
          <div className="min-w-0 flex-1">
            <Link
              to={`/courses/${encodeURIComponent(courseCode)}/modules/content/${encodeURIComponent(child.id)}`}
              className="min-w-0 text-base font-semibold leading-snug tracking-tight text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300"
            >
              {child.title}
            </Link>
            {meta ? <p className={moduleChildMetaLineClasses}>{meta}</p> : null}
          </div>
        </div>
      ) : child.kind === 'assignment' ? (
        <div className="flex items-start gap-3">
          <span
            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber-200/90 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-950/50 dark:text-amber-200"
            aria-hidden
          >
            <ClipboardList className="h-4 w-4" strokeWidth={2} />
          </span>
          <div className="min-w-0 flex-1">
            <Link
              to={`/courses/${encodeURIComponent(courseCode)}/modules/assignment/${encodeURIComponent(child.id)}`}
              className="min-w-0 text-base font-semibold leading-snug tracking-tight text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300"
            >
              {child.title}
            </Link>
            {meta ? <p className={moduleChildMetaLineClasses}>{meta}</p> : null}
          </div>
        </div>
      ) : child.kind === 'quiz' ? (
        <div className="flex items-start gap-3">
          <span
            className={
              child.isAdaptive
                ? 'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-violet-200/90 bg-violet-50 text-violet-700 dark:border-violet-500/40 dark:bg-violet-950/55 dark:text-violet-200'
                : 'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-emerald-200/90 bg-emerald-50 text-emerald-700 dark:border-emerald-500/35 dark:bg-emerald-950/50 dark:text-emerald-200'
            }
            aria-hidden
          >
            {child.isAdaptive ? (
              <Sparkles className="h-4 w-4" strokeWidth={2} />
            ) : (
              <CircleHelp className="h-4 w-4" strokeWidth={2} />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                to={`/courses/${encodeURIComponent(courseCode)}/modules/quiz/${encodeURIComponent(child.id)}`}
                className="min-w-0 text-base font-semibold leading-snug tracking-tight text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300"
                aria-label={
                  child.isAdaptive ? `${child.title} (adaptive quiz)` : undefined
                }
              >
                {child.title}
              </Link>
              {child.isAdaptive ? (
                <span className="shrink-0 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-violet-800 dark:bg-violet-900/80 dark:text-violet-200">
                  Adaptive
                </span>
              ) : null}
            </div>
            {meta ? <p className={moduleChildMetaLineClasses}>{meta}</p> : null}
          </div>
        </div>
      ) : child.kind === 'external_link' ? (
        <div className="flex items-start gap-3">
          <span
            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-violet-200/90 bg-violet-50 text-violet-700 dark:border-violet-500/40 dark:bg-violet-950/55 dark:text-violet-200"
            aria-hidden
          >
            <ExternalLink className="h-4 w-4" strokeWidth={2} />
          </span>
          <div className="min-w-0 flex-1">
            {child.externalUrl ? (
              <a
                href={child.externalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 text-base font-semibold leading-snug tracking-tight text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300"
              >
                {child.title}
              </a>
            ) : (
              <Link
                to={`/courses/${encodeURIComponent(courseCode)}/modules/external-link/${encodeURIComponent(child.id)}`}
                className="min-w-0 text-base font-semibold leading-snug tracking-tight text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300"
              >
                {child.title}
              </Link>
            )}
            {meta ? <p className={moduleChildMetaLineClasses}>{meta}</p> : null}
          </div>
        </div>
      ) : (
        <div className="min-w-0 flex-1">
          <p className="min-w-0 text-lg font-bold leading-snug tracking-tight text-slate-950 sm:text-xl dark:text-neutral-100">
            {child.title}
          </p>
          {meta ? <p className={moduleChildMetaLineClasses}>{meta}</p> : null}
        </div>
      )}
    </>
  )
}

function ModuleItemRowActions({
  child,
  disabled,
  busy,
  onTogglePublished,
  onEditTitle,
  onArchive,
}: {
  child: CourseStructureItem
  disabled: boolean
  busy: boolean
  onTogglePublished: () => void
  onEditTitle: () => void
  onArchive: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!menuOpen) return
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [menuOpen])

  return (
    <div className="flex shrink-0 items-center gap-1 sm:gap-0.5">
      <button
        type="button"
        onClick={() => onTogglePublished()}
        disabled={disabled || busy}
        title={
          child.published
            ? 'Published — visible to students when the module is available'
            : 'Draft — hidden from students; staff can still see it'
        }
        aria-label={child.published ? 'Published to students' : 'Hidden from students'}
        aria-pressed={child.published}
        className={`flex shrink-0 items-center justify-center ${child.published ? iconGhostPublished : iconGhostDraft}`}
      >
        {child.published ? (
          <Eye className="h-4 w-4" strokeWidth={2} aria-hidden />
        ) : (
          <EyeOff className="h-4 w-4" strokeWidth={2} aria-hidden />
        )}
      </button>
      <div ref={rootRef} className="relative">
        <button
          type="button"
          disabled={disabled || busy}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? menuId : undefined}
          onClick={() => {
            if (disabled || busy) return
            setMenuOpen((o) => !o)
          }}
          title="Item actions"
          className={`flex shrink-0 items-center justify-center ${iconGhost}`}
        >
          <MoreVertical className="h-4 w-4" strokeWidth={2} aria-hidden />
        </button>
        {menuOpen && (
          <div
            id={menuId}
            role="menu"
            aria-label="Module item actions"
            className="absolute right-0 z-50 mt-1 min-w-[10rem] overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg shadow-slate-900/10 dark:border-neutral-600 dark:bg-neutral-800 dark:shadow-black/40"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onEditTitle()
                setMenuOpen(false)
              }}
              className="flex w-full px-3 py-2.5 text-left text-sm font-medium text-slate-800 transition hover:bg-slate-50 dark:text-neutral-100 dark:hover:bg-neutral-700/80"
            >
              Edit title
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onArchive()
                setMenuOpen(false)
              }}
              className="flex w-full border-t border-slate-100 px-3 py-2.5 text-left text-sm font-medium text-rose-700 transition hover:bg-rose-50 dark:border-neutral-700 dark:text-rose-300 dark:hover:bg-rose-950/50"
            >
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

type SortableChildRowProps = {
  child: CourseStructureItem
  courseCode: string
  disabled: boolean
  moduleId: string
  canManageItemRow: boolean
  busyChildItemId: string | null
  dragHandlesVisible: boolean
  onChildTogglePublished: (child: CourseStructureItem) => void
  onOpenEditChildTitle: (child: CourseStructureItem) => void
  onArchiveChild: (child: CourseStructureItem) => void
}

function SortableChildRow({
  child,
  courseCode,
  disabled,
  moduleId,
  canManageItemRow,
  busyChildItemId,
  dragHandlesVisible,
  onChildTogglePublished,
  onOpenEditChildTitle,
  onArchiveChild,
}: SortableChildRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: child.id,
    disabled,
    data: { type: 'child' as const, moduleId },
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.45 : undefined,
  }

  const showRowChrome = canManageItemRow && !child.archived
  const gripAlwaysOn = dragHandlesVisible || isDragging

  return (
    <li ref={setNodeRef} style={style} className="group py-3 first:pt-0">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-2">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          {!disabled && (
            <button
              type="button"
              className={`mt-0.5 flex h-11 w-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg border-0 bg-transparent p-0 text-slate-400 shadow-none transition hover:text-slate-600 active:cursor-grabbing sm:h-9 sm:w-9 dark:text-neutral-500 dark:hover:text-neutral-300 ${
                gripAlwaysOn
                  ? 'opacity-100'
                  : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto'
              }`}
              aria-label="Drag to reorder item"
              {...listeners}
              {...attributes}
            >
              <GripVertical className="h-4 w-4" strokeWidth={2} aria-hidden />
            </button>
          )}
          <div
            className={`min-w-0 flex-1 ${child.archived ? 'opacity-70' : ''}`}
          >
            <ChildRowContent child={child} courseCode={courseCode} />
            {child.archived ? (
              <p className="mt-1 text-xs font-medium text-slate-500 dark:text-neutral-400">Archived</p>
            ) : null}
          </div>
        </div>
        {showRowChrome ? (
          <div
            className={`flex shrink-0 justify-end sm:items-center sm:self-center sm:pl-0 ${!disabled ? 'pl-[3.25rem]' : 'pl-0'}`}
          >
            <ModuleItemRowActions
              child={child}
              disabled={disabled}
              busy={busyChildItemId === child.id}
              onTogglePublished={() => onChildTogglePublished(child)}
              onEditTitle={() => onOpenEditChildTitle(child)}
              onArchive={() => onArchiveChild(child)}
            />
          </div>
        ) : null}
      </div>
    </li>
  )
}

function StaticChildRow({ child, courseCode }: { child: CourseStructureItem; courseCode: string }) {
  return (
    <li className="py-3 first:pt-0">
      <div className="min-w-0">
        <ChildRowContent child={child} courseCode={courseCode} />
      </div>
    </li>
  )
}

type ModuleCardBodyProps = {
  item: CourseStructureItem
  moduleChildrenById: Map<string, CourseStructureItem[]>
  canEditModules: boolean
  anyModalBusy: boolean
  onModuleItemAdd: (moduleId: string, kind: ModuleItemKind) => void
  minified: boolean
  collapsed: boolean
  onToggleCollapsed: () => void
  busyModuleId: string | null
  onTogglePublished: (item: CourseStructureItem) => void
  onOpenModuleSettings: (item: CourseStructureItem) => void
  moduleDragHandle: ReactNode
  childrenList: ReactNode | null
}

function ModuleCardBody({
  item,
  moduleChildrenById,
  canEditModules,
  anyModalBusy,
  onModuleItemAdd,
  minified,
  collapsed,
  onToggleCollapsed,
  busyModuleId,
  onTogglePublished,
  onOpenModuleSettings,
  moduleDragHandle,
  childrenList,
}: ModuleCardBodyProps) {
  const children = moduleChildrenById.get(item.id) ?? []
  const moduleItemsRegionId = `module-items-${item.id}`
  const showAccordionToggle = !minified && children.length > 0
  return (
    <div
      className={`w-full rounded-2xl border border-slate-200/70 bg-slate-50/60 shadow-sm dark:border-neutral-700/80 dark:bg-neutral-800/85 ${
        minified ? 'p-2.5' : 'p-4'
      }`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-3">
        <div className="group flex min-w-0 flex-1 items-start gap-2 sm:gap-3">
          {moduleDragHandle}
          <div className="min-w-0 flex-1">
            {showAccordionToggle ? (
              <button
                type="button"
                onClick={onToggleCollapsed}
                aria-expanded={!collapsed}
                aria-controls={moduleItemsRegionId}
                className="w-full min-w-0 rounded-xl px-1 py-0.5 text-left transition hover:bg-slate-200/40 dark:hover:bg-neutral-700/50"
              >
                <span className="flex items-start gap-2">
                  <span
                    className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center text-slate-500 dark:text-neutral-400"
                    aria-hidden
                  >
                    {collapsed ? (
                      <ChevronRight className="h-4 w-4" strokeWidth={2} />
                    ) : (
                      <ChevronDown className="h-4 w-4" strokeWidth={2} />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-slate-950 dark:text-neutral-100">
                      {item.title}
                    </span>
                    {!collapsed ? (
                      <span className="mt-1 block text-xs font-normal text-slate-500 dark:text-neutral-400">
                        Course activities and items can be grouped under this module.
                      </span>
                    ) : (
                      <span className="mt-1 block text-xs font-normal text-slate-500 dark:text-neutral-400">
                        {children.length} {children.length === 1 ? 'item' : 'items'}
                      </span>
                    )}
                  </span>
                </span>
              </button>
            ) : (
              <>
                <p className="text-sm font-semibold text-slate-950 dark:text-neutral-100">{item.title}</p>
                {!minified && (
                  <p className="mt-1 text-xs text-slate-500 dark:text-neutral-400">
                    Course activities and items can be grouped under this module.
                  </p>
                )}
                {minified && children.length > 0 && (
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-neutral-400">
                    {children.length} {children.length === 1 ? 'item' : 'items'}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
        {canEditModules && !minified && (
          <div className="flex w-full flex-wrap items-center justify-end gap-1 border-t border-slate-200/60 pt-3 sm:w-auto sm:shrink-0 sm:flex-nowrap sm:border-0 sm:pt-0 dark:border-neutral-600/60">
            <button
              type="button"
              onClick={() => onTogglePublished(item)}
              disabled={anyModalBusy || busyModuleId === item.id}
              title={
                item.published
                  ? 'Published — visible to students when scheduled'
                  : 'Draft — hidden from students'
              }
              aria-label={item.published ? 'Published to students' : 'Hidden from students'}
              aria-pressed={item.published}
              className={`flex shrink-0 items-center justify-center ${
                item.published ? iconGhostPublished : iconGhostDraft
              }`}
            >
              {item.published ? (
                <Eye className="h-4 w-4" strokeWidth={2} aria-hidden />
              ) : (
                <EyeOff className="h-4 w-4" strokeWidth={2} aria-hidden />
              )}
            </button>
            <button
              type="button"
              onClick={() => onOpenModuleSettings(item)}
              disabled={anyModalBusy}
              title="Module settings"
              aria-label="Module settings"
              className={`flex shrink-0 items-center justify-center ${iconGhost}`}
            >
              <Settings className="h-4 w-4" strokeWidth={2} aria-hidden />
            </button>
            <AddModuleItemMenu
              onAdd={(kind) => onModuleItemAdd(item.id, kind)}
              disabled={anyModalBusy}
            />
          </div>
        )}
      </div>
      {!minified && !collapsed && children.length > 0 && childrenList}
    </div>
  )
}

type SortableModuleCardProps = {
  item: CourseStructureItem
  courseCode: string
  moduleChildrenById: Map<string, CourseStructureItem[]>
  canEditModules: boolean
  anyModalBusy: boolean
  onModuleItemAdd: (moduleId: string, kind: ModuleItemKind) => void
  minified: boolean
  collapsed: boolean
  onToggleCollapsed: (moduleId: string) => void
  busyModuleId: string | null
  busyChildItemId: string | null
  dragHandlesVisible: boolean
  onTogglePublished: (item: CourseStructureItem) => void
  onOpenModuleSettings: (item: CourseStructureItem) => void
  onChildTogglePublished: (child: CourseStructureItem) => void
  onOpenEditChildTitle: (child: CourseStructureItem) => void
  onArchiveChild: (child: CourseStructureItem) => void
}

function SortableModuleCard({
  item,
  courseCode,
  moduleChildrenById,
  canEditModules,
  anyModalBusy,
  onModuleItemAdd,
  minified,
  collapsed,
  onToggleCollapsed,
  busyModuleId,
  busyChildItemId,
  dragHandlesVisible,
  onTogglePublished,
  onOpenModuleSettings,
  onChildTogglePublished,
  onOpenEditChildTitle,
  onArchiveChild,
}: SortableModuleCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: !canEditModules,
    data: { type: 'module' as const },
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.55 : undefined,
  }

  const children = moduleChildrenById.get(item.id) ?? []
  const childIds = children.map((c) => c.id)

  const childrenList =
    !minified && !collapsed && children.length > 0 ? (
      <SortableContext
        id={`module-children-${item.id}`}
        items={childIds}
        strategy={verticalListSortingStrategy}
      >
        <ul
          id={`module-items-${item.id}`}
          className="mt-4 divide-y divide-slate-200/55 border-t border-slate-200/55 pt-4 dark:divide-neutral-700/80 dark:border-neutral-700/80"
        >
          {children.map((child) => (
            <SortableChildRow
              key={child.id}
              child={child}
              courseCode={courseCode}
              moduleId={item.id}
              disabled={!canEditModules || anyModalBusy}
              canManageItemRow={canEditModules}
              busyChildItemId={busyChildItemId}
              dragHandlesVisible={dragHandlesVisible}
              onChildTogglePublished={onChildTogglePublished}
              onOpenEditChildTitle={onOpenEditChildTitle}
              onArchiveChild={onArchiveChild}
            />
          ))}
        </ul>
      </SortableContext>
    ) : null

  return (
    <li ref={setNodeRef} style={style} className="w-full">
      <ModuleCardBody
        item={item}
        moduleChildrenById={moduleChildrenById}
        canEditModules={canEditModules}
        anyModalBusy={anyModalBusy}
        onModuleItemAdd={onModuleItemAdd}
        minified={minified}
        collapsed={collapsed}
        onToggleCollapsed={() => onToggleCollapsed(item.id)}
        busyModuleId={busyModuleId}
        onTogglePublished={onTogglePublished}
        onOpenModuleSettings={onOpenModuleSettings}
        moduleDragHandle={
          canEditModules ? (
            <button
              type="button"
              className={`mt-0.5 flex h-11 w-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg border-0 bg-transparent p-0 text-slate-400 shadow-none transition hover:text-slate-600 active:cursor-grabbing sm:h-9 sm:w-9 dark:text-neutral-500 dark:hover:text-neutral-300 ${
                dragHandlesVisible || isDragging
                  ? 'opacity-100'
                  : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto'
              }`}
              aria-label="Drag to reorder module"
              {...listeners}
              {...attributes}
            >
              <GripVertical className="h-4 w-4" strokeWidth={2} aria-hidden />
            </button>
          ) : null
        }
        childrenList={childrenList}
      />
    </li>
  )
}

function StaticModuleCard({
  item,
  courseCode,
  moduleChildrenById,
}: {
  item: CourseStructureItem
  courseCode: string
  moduleChildrenById: Map<string, CourseStructureItem[]>
}) {
  const [collapsed, setCollapsed] = useState(false)
  const children = moduleChildrenById.get(item.id) ?? []
  const childrenList =
    !collapsed && children.length > 0 ? (
      <ul
        id={`module-items-${item.id}`}
        className="mt-4 divide-y divide-slate-200/55 border-t border-slate-200/55 pt-4 dark:divide-neutral-700/80 dark:border-neutral-700/80"
      >
        {children.map((child) => (
          <StaticChildRow key={child.id} child={child} courseCode={courseCode} />
        ))}
      </ul>
    ) : null

  return (
    <li className="w-full">
      <ModuleCardBody
        item={item}
        moduleChildrenById={moduleChildrenById}
        canEditModules={false}
        anyModalBusy={false}
        onModuleItemAdd={() => {}}
        minified={false}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((c) => !c)}
        busyModuleId={null}
        onTogglePublished={() => {}}
        onOpenModuleSettings={() => {}}
        moduleDragHandle={null}
        childrenList={childrenList}
      />
    </li>
  )
}

export default function CourseModules() {
  const { courseCode } = useParams<{ courseCode: string }>()
  const archiveDialogTitleId = useId()
  const { allows, loading: permissionsLoading, error: permissionsError } = usePermissions()
  const [items, setItems] = useState<CourseStructureItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reorderError, setReorderError] = useState<string | null>(null)
  const [reorderSaving, setReorderSaving] = useState(false)

  const [moduleModalOpen, setModuleModalOpen] = useState(false)
  const [moduleModalKey, setModuleModalKey] = useState(0)
  const [moduleSaving, setModuleSaving] = useState(false)
  const [moduleSaveError, setModuleSaveError] = useState<string | null>(null)

  const [headingModalOpen, setHeadingModalOpen] = useState(false)
  const [headingModalKey, setHeadingModalKey] = useState(0)
  const [headingModuleId, setHeadingModuleId] = useState<string | null>(null)
  const [headingSaving, setHeadingSaving] = useState(false)
  const [headingSaveError, setHeadingSaveError] = useState<string | null>(null)

  const [contentPageModalOpen, setContentPageModalOpen] = useState(false)
  const [contentPageModalKey, setContentPageModalKey] = useState(0)
  const [contentPageModuleId, setContentPageModuleId] = useState<string | null>(null)
  const [contentPageSaving, setContentPageSaving] = useState(false)
  const [contentPageSaveError, setContentPageSaveError] = useState<string | null>(null)

  const [assignmentModalOpen, setAssignmentModalOpen] = useState(false)
  const [assignmentModalKey, setAssignmentModalKey] = useState(0)
  const [assignmentModuleId, setAssignmentModuleId] = useState<string | null>(null)
  const [assignmentSaving, setAssignmentSaving] = useState(false)
  const [assignmentSaveError, setAssignmentSaveError] = useState<string | null>(null)
  const [quizModalOpen, setQuizModalOpen] = useState(false)
  const [quizModalKey, setQuizModalKey] = useState(0)
  const [quizModuleId, setQuizModuleId] = useState<string | null>(null)
  const [quizSaving, setQuizSaving] = useState(false)
  const [quizSaveError, setQuizSaveError] = useState<string | null>(null)
  const [externalLinkModalOpen, setExternalLinkModalOpen] = useState(false)
  const [externalLinkModalKey, setExternalLinkModalKey] = useState(0)
  const [externalLinkModuleId, setExternalLinkModuleId] = useState<string | null>(null)
  const [externalLinkSaving, setExternalLinkSaving] = useState(false)
  const [externalLinkSaveError, setExternalLinkSaveError] = useState<string | null>(null)
  const [busyModuleId, setBusyModuleId] = useState<string | null>(null)
  const [busyChildItemId, setBusyChildItemId] = useState<string | null>(null)
  const [moduleActionError, setModuleActionError] = useState<string | null>(null)
  const [editItemModalKey, setEditItemModalKey] = useState(0)
  const [editItemModalOpen, setEditItemModalOpen] = useState(false)
  const [editTargetItem, setEditTargetItem] = useState<CourseStructureItem | null>(null)
  const [editItemSaving, setEditItemSaving] = useState(false)
  const [editItemError, setEditItemError] = useState<string | null>(null)
  const [moduleSettingsOpen, setModuleSettingsOpen] = useState(false)
  const [moduleSettingsKey, setModuleSettingsKey] = useState(0)
  const [moduleSettingsModuleId, setModuleSettingsModuleId] = useState<string | null>(null)
  const [moduleSettingsSaving, setModuleSettingsSaving] = useState(false)
  const [moduleSettingsSaveError, setModuleSettingsSaveError] = useState<string | null>(null)
  const [archiveConfirmItem, setArchiveConfirmItem] = useState<CourseStructureItem | null>(null)

  const [isDraggingModule, setIsDraggingModule] = useState(false)
  const [activeDragId, setActiveDragId] = useState<string | null>(null)
  const [collapsedModuleIds, setCollapsedModuleIds] = useState<Set<string>>(() => new Set())
  const [dragHandlesVisible, setDragHandlesVisible] = useState(false)

  const toggleModuleCollapsed = useCallback((moduleId: string) => {
    setCollapsedModuleIds((prev) => {
      const next = new Set(prev)
      if (next.has(moduleId)) next.delete(moduleId)
      else next.add(moduleId)
      return next
    })
  }, [])

  /** `course:<courseCode>:item:create` — structure edit, reorder, and add items (server: `course_grants::course_item_create_permission`). */
  const itemCreatePerm = courseCode ? permCourseItemCreate(courseCode) : ''
  const courseViewMode = useCourseViewAs(courseCode)
  const viewAsStudent = courseViewMode === 'student'
  /** Student preview is read-only: never show authoring chrome even if wildcards still match `allows()`. */
  const canEditModules = Boolean(
    courseCode &&
      !permissionsLoading &&
      !permissionsError &&
      !viewAsStudent &&
      allows(itemCreatePerm),
  )
  const showViewerOnlyHint = Boolean(
    courseCode && !permissionsLoading && !permissionsError && !allows(itemCreatePerm),
  )

  const blockingUi =
    moduleSaving ||
    moduleModalOpen ||
    headingSaving ||
    headingModalOpen ||
    contentPageSaving ||
    contentPageModalOpen ||
    assignmentSaving ||
    assignmentModalOpen ||
    quizSaving ||
    quizModalOpen ||
    externalLinkSaving ||
    externalLinkModalOpen ||
    moduleSettingsSaving ||
    moduleSettingsOpen ||
    editItemSaving ||
    editItemModalOpen ||
    archiveConfirmItem !== null

  const anyModalBusy = blockingUi || reorderSaving

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!courseCode) return
    const silent = Boolean(opts?.silent)
    if (!silent) setLoading(true)
    setLoadError(null)
    setModuleActionError(null)
    try {
      const list = await fetchCourseStructure(courseCode)
      setItems(list)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load course structure.')
      setItems([])
    } finally {
      if (!silent) setLoading(false)
    }
  }, [courseCode])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!archiveConfirmItem) return
    const archivingId = archiveConfirmItem.id
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (busyChildItemId === archivingId) return
      e.preventDefault()
      setArchiveConfirmItem(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [archiveConfirmItem, busyChildItemId])

  const saveModule = useCallback(
    async (title: string) => {
      if (!courseCode) return
      setModuleSaveError(null)
      setModuleSaving(true)
      try {
        await createCourseModule(courseCode, { title })
        await load({ silent: true })
        setModuleModalOpen(false)
      } catch (e) {
        setModuleSaveError(e instanceof Error ? e.message : 'Could not save module.')
      } finally {
        setModuleSaving(false)
      }
    },
    [courseCode, load],
  )

  const saveHeading = useCallback(
    async (title: string) => {
      if (!courseCode || !headingModuleId) return
      setHeadingSaveError(null)
      setHeadingSaving(true)
      try {
        await createModuleHeading(courseCode, headingModuleId, { title })
        await load({ silent: true })
        setHeadingModalOpen(false)
        setHeadingModuleId(null)
      } catch (e) {
        setHeadingSaveError(e instanceof Error ? e.message : 'Could not save heading.')
      } finally {
        setHeadingSaving(false)
      }
    },
    [courseCode, headingModuleId, load],
  )

  const saveContentPage = useCallback(
    async (title: string) => {
      if (!courseCode || !contentPageModuleId) return
      setContentPageSaveError(null)
      setContentPageSaving(true)
      try {
        await createModuleContentPage(courseCode, contentPageModuleId, { title })
        await load({ silent: true })
        setContentPageModalOpen(false)
        setContentPageModuleId(null)
      } catch (e) {
        setContentPageSaveError(e instanceof Error ? e.message : 'Could not save page.')
      } finally {
        setContentPageSaving(false)
      }
    },
    [courseCode, contentPageModuleId, load],
  )

  const saveAssignment = useCallback(
    async (title: string) => {
      if (!courseCode || !assignmentModuleId) return
      setAssignmentSaveError(null)
      setAssignmentSaving(true)
      try {
        await createModuleAssignment(courseCode, assignmentModuleId, { title })
        await load({ silent: true })
        setAssignmentModalOpen(false)
        setAssignmentModuleId(null)
      } catch (e) {
        setAssignmentSaveError(e instanceof Error ? e.message : 'Could not save assignment.')
      } finally {
        setAssignmentSaving(false)
      }
    },
    [courseCode, assignmentModuleId, load],
  )

  const saveQuiz = useCallback(
    async (title: string) => {
      if (!courseCode || !quizModuleId) return
      setQuizSaveError(null)
      setQuizSaving(true)
      try {
        await createModuleQuiz(courseCode, quizModuleId, { title })
        await load({ silent: true })
        setQuizModalOpen(false)
        setQuizModuleId(null)
      } catch (e) {
        setQuizSaveError(e instanceof Error ? e.message : 'Could not save quiz.')
      } finally {
        setQuizSaving(false)
      }
    },
    [courseCode, quizModuleId, load],
  )

  const saveExternalLink = useCallback(
    async (title: string, url: string) => {
      if (!courseCode || !externalLinkModuleId) return
      setExternalLinkSaveError(null)
      setExternalLinkSaving(true)
      try {
        await createModuleExternalLink(courseCode, externalLinkModuleId, { title, url })
        await load({ silent: true })
        setExternalLinkModalOpen(false)
        setExternalLinkModuleId(null)
      } catch (e) {
        setExternalLinkSaveError(e instanceof Error ? e.message : 'Could not save external link.')
      } finally {
        setExternalLinkSaving(false)
      }
    },
    [courseCode, externalLinkModuleId, load],
  )

  const openAddModule = useCallback(() => {
    if (!courseCode) return
    setModuleSaveError(null)
    setModuleModalKey((k) => k + 1)
    setModuleModalOpen(true)
  }, [courseCode])

  const onModuleItemAdd = useCallback((moduleId: string, kind: ModuleItemKind) => {
    if (kind === 'heading') {
      setHeadingSaveError(null)
      setHeadingModuleId(moduleId)
      setHeadingModalKey((k) => k + 1)
      setHeadingModalOpen(true)
      return
    }
    if (kind === 'content_page') {
      setContentPageSaveError(null)
      setContentPageModuleId(moduleId)
      setContentPageModalKey((k) => k + 1)
      setContentPageModalOpen(true)
      return
    }
    if (kind === 'assignment') {
      setAssignmentSaveError(null)
      setAssignmentModuleId(moduleId)
      setAssignmentModalKey((k) => k + 1)
      setAssignmentModalOpen(true)
      return
    }
    if (kind === 'quiz') {
      setQuizSaveError(null)
      setQuizModuleId(moduleId)
      setQuizModalKey((k) => k + 1)
      setQuizModalOpen(true)
      return
    }
    if (kind === 'external_link') {
      setExternalLinkSaveError(null)
      setExternalLinkModuleId(moduleId)
      setExternalLinkModalKey((k) => k + 1)
      setExternalLinkModalOpen(true)
    }
  }, [])

  const handleTogglePublished = useCallback(
    async (item: CourseStructureItem) => {
      if (!courseCode) return
      setModuleActionError(null)
      setBusyModuleId(item.id)
      try {
        await patchCourseModule(courseCode, item.id, {
          title: item.title,
          published: !item.published,
          visibleFrom: item.visibleFrom,
        })
        await load({ silent: true })
      } catch (e) {
        setModuleActionError(e instanceof Error ? e.message : 'Could not update module.')
      } finally {
        setBusyModuleId(null)
      }
    },
    [courseCode, load],
  )

  const handleChildTogglePublished = useCallback(
    async (child: CourseStructureItem) => {
      if (!courseCode) return
      setModuleActionError(null)
      setBusyChildItemId(child.id)
      try {
        await patchCourseStructureItem(courseCode, child.id, { published: !child.published })
        await load({ silent: true })
      } catch (e) {
        setModuleActionError(e instanceof Error ? e.message : 'Could not update item.')
      } finally {
        setBusyChildItemId(null)
      }
    },
    [courseCode, load],
  )

  const openEditChildTitle = useCallback((child: CourseStructureItem) => {
    setEditItemError(null)
    setEditTargetItem(child)
    setEditItemModalKey((k) => k + 1)
    setEditItemModalOpen(true)
  }, [])

  const saveEditChildTitle = useCallback(
    async (title: string) => {
      if (!courseCode || !editTargetItem) return
      setEditItemError(null)
      setEditItemSaving(true)
      try {
        await patchCourseStructureItem(courseCode, editTargetItem.id, { title })
        await load({ silent: true })
        setEditItemModalOpen(false)
        setEditTargetItem(null)
      } catch (e) {
        setEditItemError(e instanceof Error ? e.message : 'Could not save title.')
      } finally {
        setEditItemSaving(false)
      }
    },
    [courseCode, editTargetItem, load],
  )

  const requestArchiveChild = useCallback((child: CourseStructureItem) => {
    if (!courseCode) return
    setArchiveConfirmItem(child)
  }, [courseCode])

  const confirmArchiveChild = useCallback(async () => {
    if (!courseCode || !archiveConfirmItem) return
    const child = archiveConfirmItem
    setModuleActionError(null)
    setBusyChildItemId(child.id)
    try {
      await archiveCourseStructureItem(courseCode, child.id)
      await load({ silent: true })
      setArchiveConfirmItem(null)
    } catch (e) {
      setModuleActionError(e instanceof Error ? e.message : 'Could not archive item.')
    } finally {
      setBusyChildItemId(null)
    }
  }, [archiveConfirmItem, courseCode, load])

  const handleOpenModuleSettings = useCallback((item: CourseStructureItem) => {
    setModuleSettingsSaveError(null)
    setModuleSettingsModuleId(item.id)
    setModuleSettingsKey((k) => k + 1)
    setModuleSettingsOpen(true)
  }, [])

  const saveModuleSettings = useCallback(
    async (payload: { title: string; published: boolean; visibleFrom: string | null }) => {
      if (!courseCode || !moduleSettingsModuleId) return
      setModuleSettingsSaveError(null)
      setModuleSettingsSaving(true)
      try {
        await patchCourseModule(courseCode, moduleSettingsModuleId, payload)
        await load({ silent: true })
        setModuleSettingsOpen(false)
        setModuleSettingsModuleId(null)
      } catch (e) {
        setModuleSettingsSaveError(e instanceof Error ? e.message : 'Could not save module.')
      } finally {
        setModuleSettingsSaving(false)
      }
    },
    [courseCode, moduleSettingsModuleId, load],
  )

  const settingsTargetItem = useMemo(
    () => items.find((i) => i.id === moduleSettingsModuleId) ?? null,
    [items, moduleSettingsModuleId],
  )

  const topLevelItems = useMemo(() => items.filter((i) => !i.parentId), [items])

  const sortedTopLevel = useMemo(
    () => [...topLevelItems].sort((a, b) => a.sortOrder - b.sortOrder),
    [topLevelItems],
  )

  const nonModuleTopLevel = useMemo(
    () => sortedTopLevel.filter((i) => i.kind !== 'module'),
    [sortedTopLevel],
  )

  const moduleIds = useMemo(() => {
    return sortedTopLevel.filter((i) => i.kind === 'module').map((m) => m.id)
  }, [sortedTopLevel])

  const handleCollapseExpandAllModules = useCallback(() => {
    setCollapsedModuleIds((prev) => {
      const allCollapsed =
        moduleIds.length > 0 && moduleIds.every((id) => prev.has(id))
      if (allCollapsed) return new Set()
      return new Set(moduleIds)
    })
  }, [moduleIds])

  const moduleChildrenById = useMemo(() => {
    const m = new Map<string, CourseStructureItem[]>()
    for (const i of items) {
      if (
        (i.kind === 'heading' ||
          i.kind === 'content_page' ||
          i.kind === 'assignment' ||
          i.kind === 'quiz' ||
          i.kind === 'external_link') &&
        i.parentId
      ) {
        const list = m.get(i.parentId) ?? []
        list.push(i)
        m.set(i.parentId, list)
      }
    }
    for (const [, list] of m) {
      list.sort((a, b) => a.sortOrder - b.sortOrder)
    }
    return m
  }, [items])

  const persistReorder = useCallback(
    async (body: { moduleOrder: string[]; childOrderByModule: Record<string, string[]> }) => {
      if (!courseCode) return
      setReorderError(null)
      setReorderSaving(true)
      try {
        const next = await reorderCourseStructure(courseCode, body)
        setItems(next)
      } catch (e) {
        setReorderError(e instanceof Error ? e.message : 'Could not save order.')
        await load({ silent: true })
      } finally {
        setReorderSaving(false)
      }
    },
    [courseCode, load],
  )

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragId(String(event.active.id))
    if (event.active.data.current?.type === 'module') {
      setIsDraggingModule(true)
    }
  }, [])

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      setIsDraggingModule(false)
      setActiveDragId(null)
      if (!over || !courseCode || reorderSaving) return

      const activeType = active.data.current?.type as string | undefined
      if (activeType === 'module') {
        if (active.id === over.id) return
        const oldIndex = moduleIds.indexOf(String(active.id))
        const newIndex = moduleIds.indexOf(String(over.id))
        if (oldIndex < 0 || newIndex < 0) return
        const nextModuleOrder = arrayMove(moduleIds, oldIndex, newIndex)
        const base = buildReorderPayloadFromItems(items)
        void persistReorder({
          moduleOrder: nextModuleOrder,
          childOrderByModule: base.childOrderByModule,
        })
        return
      }

      if (activeType === 'child') {
        const moduleId = active.data.current?.moduleId as string | undefined
        if (!moduleId) return
        const overModuleId =
          (over.data.current?.moduleId as string | undefined) ??
          findModuleIdForChildItem(String(over.id), moduleChildrenById)
        if (!overModuleId || moduleId !== overModuleId) return
        if (active.id === over.id) return
        const childList = moduleChildrenById.get(moduleId) ?? []
        const childIds = childList.map((c) => c.id)
        const oldIndex = childIds.indexOf(String(active.id))
        const newIndex = childIds.indexOf(String(over.id))
        if (oldIndex < 0 || newIndex < 0) return
        const nextChildren = arrayMove(childIds, oldIndex, newIndex)
        const base = buildReorderPayloadFromItems(items)
        void persistReorder({
          moduleOrder: base.moduleOrder,
          childOrderByModule: { ...base.childOrderByModule, [moduleId]: nextChildren },
        })
      }
    },
    [courseCode, items, moduleChildrenById, moduleIds, persistReorder, reorderSaving],
  )

  const handleDragCancel = useCallback(() => {
    setIsDraggingModule(false)
    setActiveDragId(null)
  }, [])

  const activeItem = useMemo(() => {
    if (!activeDragId) return null
    return items.find((i) => i.id === activeDragId) ?? null
  }, [activeDragId, items])

  const hasRows = items.length > 0
  const empty = !loading && !loadError && !hasRows

  if (!courseCode) {
    return (
      <LmsPage title="Modules" description="">
        <p className="mt-6 text-sm text-slate-500 dark:text-neutral-400">Invalid link.</p>
      </LmsPage>
    )
  }

  return (
    <LmsPage
      title="Modules"
      description=""
      actions={
        courseCode && canEditModules ? (
          <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:justify-end">
            <AddCourseItemMenu
              onAdd={openAddModule}
              disabled={anyModalBusy}
              dragHandlesVisible={dragHandlesVisible}
              onToggleDragHandles={() => setDragHandlesVisible((v) => !v)}
              moduleListActionsEnabled={moduleIds.length > 0}
              allModulesCollapsed={
                moduleIds.length > 0 && moduleIds.every((id) => collapsedModuleIds.has(id))
              }
              onCollapseExpandAllModules={handleCollapseExpandAllModules}
            />
          </div>
        ) : null
      }
    >
      {loadError && (
        <p className="mt-6 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-200">
          {loadError}
        </p>
      )}
      {reorderError && (
        <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-200">
          {reorderError}
        </p>
      )}
      {moduleActionError && (
        <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-200">
          {moduleActionError}
        </p>
      )}
      {loading && <p className="mt-8 text-sm text-slate-500 dark:text-neutral-400">Loading modules…</p>}
      {!loading && showViewerOnlyHint && (
        <p className="mt-8 text-sm text-slate-500 dark:text-neutral-400">
          You can view this outline, but only the course creator and assigned course teachers can add
          modules.
        </p>
      )}
      {empty && canEditModules && (
        <p className="mt-8 text-sm text-slate-500 dark:text-neutral-400">
          No course items yet. Use{' '}
          <span className="font-medium text-slate-700 dark:text-neutral-300">Actions</span>, then <span className="font-medium text-slate-700 dark:text-neutral-300">Add Module</span>, to add a module.
        </p>
      )}
      {empty && !canEditModules && (
        <p className="mt-8 text-sm text-slate-500 dark:text-neutral-400">No modules yet.</p>
      )}
      {!loading && hasRows && canEditModules && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          {nonModuleTopLevel.length > 0 && (
            <ul className="mt-8 flex w-full max-w-none flex-col gap-3">
              {nonModuleTopLevel.map((item) => (
                <li key={item.id} className="w-full">
                  <p className="text-base font-semibold tracking-tight text-slate-950 dark:text-neutral-100">
                    {item.title}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <SortableContext
            id={MODULE_SORT_ID}
            items={moduleIds}
            strategy={verticalListSortingStrategy}
          >
            <ul
              className={`flex w-full max-w-none flex-col gap-3 ${nonModuleTopLevel.length > 0 ? 'mt-3' : 'mt-8'}`}
            >
              {sortedTopLevel
                .filter((i) => i.kind === 'module')
                .map((item) => (
                  <SortableModuleCard
                    key={item.id}
                    item={item}
                    courseCode={courseCode!}
                    moduleChildrenById={moduleChildrenById}
                    canEditModules
                    anyModalBusy={anyModalBusy}
                    onModuleItemAdd={onModuleItemAdd}
                    minified={isDraggingModule}
                    collapsed={collapsedModuleIds.has(item.id)}
                    onToggleCollapsed={toggleModuleCollapsed}
                    busyModuleId={busyModuleId}
                    busyChildItemId={busyChildItemId}
                    dragHandlesVisible={dragHandlesVisible}
                    onTogglePublished={handleTogglePublished}
                    onOpenModuleSettings={handleOpenModuleSettings}
                    onChildTogglePublished={handleChildTogglePublished}
                    onOpenEditChildTitle={openEditChildTitle}
                    onArchiveChild={requestArchiveChild}
                  />
                ))}
            </ul>
          </SortableContext>
          {/* DragOverlay disables node rect-delta compensation; collapsing modules shifts layout and
              desyncs the overlay from the cursor. Only use DragOverlay for in-module item drags. */}
          {activeDragId && activeItem && activeItem.kind !== 'module' ? (
            <DragOverlay dropAnimation={null}>
              <div className="pointer-events-none max-w-lg rounded-xl border border-slate-300 bg-white px-3 py-2 shadow-lg dark:border-neutral-600 dark:bg-neutral-800">
                <p className="text-sm font-semibold text-slate-950 dark:text-neutral-100">{activeItem.title}</p>
                <p className="text-xs text-slate-500 dark:text-neutral-400">
                  {activeItem.kind === 'content_page'
                    ? 'Page'
                    : activeItem.kind === 'assignment'
                      ? 'Assignment'
                      : activeItem.kind === 'quiz'
                        ? activeItem.isAdaptive
                          ? 'Adaptive quiz'
                          : 'Quiz'
                        : activeItem.kind === 'external_link'
                          ? 'External link'
                          : 'Heading'}
                </p>
              </div>
            </DragOverlay>
          ) : null}
        </DndContext>
      )}
      {!loading && hasRows && !canEditModules && (
        <>
          {nonModuleTopLevel.length > 0 && (
            <ul className="mt-8 flex w-full max-w-none flex-col gap-3">
              {nonModuleTopLevel.map((item) => (
                <li key={item.id} className="w-full">
                  <p className="text-base font-semibold tracking-tight text-slate-950 dark:text-neutral-100">
                    {item.title}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <ul
            className={`flex w-full max-w-none flex-col gap-3 ${nonModuleTopLevel.length > 0 ? 'mt-3' : 'mt-8'}`}
          >
            {sortedTopLevel
              .filter((i) => i.kind === 'module')
              .map((item) => (
                <StaticModuleCard
                  key={item.id}
                  item={item}
                  courseCode={courseCode!}
                  moduleChildrenById={moduleChildrenById}
                />
              ))}
          </ul>
        </>
      )}

      <ModuleNameModal
        key={`module-name-${moduleModalKey}`}
        open={moduleModalOpen}
        onClose={() => {
          if (!moduleSaving) setModuleModalOpen(false)
        }}
        onSave={(title) => void saveModule(title)}
        saving={moduleSaving}
        errorMessage={moduleSaveError}
        mode="module"
      />

      <ModuleNameModal
        key={`heading-${headingModalKey}`}
        open={headingModalOpen}
        onClose={() => {
          if (!headingSaving) {
            setHeadingModalOpen(false)
            setHeadingModuleId(null)
          }
        }}
        onSave={(title) => void saveHeading(title)}
        saving={headingSaving}
        errorMessage={headingSaveError}
        mode="heading"
      />

      <ModuleNameModal
        key={`content-page-${contentPageModalKey}`}
        open={contentPageModalOpen}
        onClose={() => {
          if (!contentPageSaving) {
            setContentPageModalOpen(false)
            setContentPageModuleId(null)
          }
        }}
        onSave={(title) => void saveContentPage(title)}
        saving={contentPageSaving}
        errorMessage={contentPageSaveError}
        mode="content_page"
      />

      <ModuleNameModal
        key={`assignment-${assignmentModalKey}`}
        open={assignmentModalOpen}
        onClose={() => {
          if (!assignmentSaving) {
            setAssignmentModalOpen(false)
            setAssignmentModuleId(null)
          }
        }}
        onSave={(title) => void saveAssignment(title)}
        saving={assignmentSaving}
        errorMessage={assignmentSaveError}
        mode="assignment"
      />

      <ModuleNameModal
        key={`quiz-${quizModalKey}`}
        open={quizModalOpen}
        onClose={() => {
          if (!quizSaving) {
            setQuizModalOpen(false)
            setQuizModuleId(null)
          }
        }}
        onSave={(title) => void saveQuiz(title)}
        saving={quizSaving}
        errorMessage={quizSaveError}
        mode="quiz"
      />

      <ModuleExternalLinkModal
        key={`external-link-${externalLinkModalKey}`}
        open={externalLinkModalOpen}
        onClose={() => {
          if (!externalLinkSaving) {
            setExternalLinkModalOpen(false)
            setExternalLinkModuleId(null)
          }
        }}
        onSave={(title, url) => void saveExternalLink(title, url)}
        saving={externalLinkSaving}
        errorMessage={externalLinkSaveError}
      />

      <ModuleNameModal
        key={`edit-structure-item-${editItemModalKey}`}
        open={editItemModalOpen && editTargetItem !== null}
        onClose={() => {
          if (!editItemSaving) {
            setEditItemModalOpen(false)
            setEditTargetItem(null)
          }
        }}
        onSave={(title) => void saveEditChildTitle(title)}
        saving={editItemSaving}
        errorMessage={editItemError}
        mode={
          editTargetItem?.kind === 'heading'
            ? 'heading'
            : editTargetItem?.kind === 'content_page'
              ? 'content_page'
              : editTargetItem?.kind === 'assignment'
                ? 'assignment'
                : editTargetItem?.kind === 'quiz'
                  ? 'quiz'
                  : editTargetItem?.kind === 'external_link'
                    ? 'external_link'
                  : 'content_page'
        }
        initialTitle={editTargetItem?.title ?? ''}
        dialogTitleOverride="Edit title"
        submitLabelOverride="Save title"
      />

      <ModuleSettingsModal
        key={`module-settings-${moduleSettingsKey}`}
        open={moduleSettingsOpen && settingsTargetItem !== null}
        initialTitle={settingsTargetItem?.title ?? ''}
        initialPublished={settingsTargetItem?.published ?? true}
        initialVisibleFrom={settingsTargetItem?.visibleFrom ?? null}
        onClose={() => {
          if (!moduleSettingsSaving) {
            setModuleSettingsOpen(false)
            setModuleSettingsModuleId(null)
          }
        }}
        onSave={(payload) => void saveModuleSettings(payload)}
        saving={moduleSettingsSaving}
        errorMessage={moduleSettingsSaveError}
      />

      {archiveConfirmItem ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby={archiveDialogTitleId}
          onClick={(e) => {
            if (
              e.target === e.currentTarget &&
              busyChildItemId !== archiveConfirmItem.id
            ) {
              setArchiveConfirmItem(null)
            }
          }}
        >
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-neutral-600 dark:bg-neutral-800">
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-neutral-600">
              <h3
                id={archiveDialogTitleId}
                className="text-sm font-semibold text-slate-900 dark:text-neutral-100"
              >
                Delete item
              </h3>
              <button
                type="button"
                onClick={() => {
                  if (busyChildItemId !== archiveConfirmItem.id) setArchiveConfirmItem(null)
                }}
                disabled={busyChildItemId === archiveConfirmItem.id}
                className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
                aria-label="Close"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <div className="p-4">
              <p className="text-sm leading-relaxed text-slate-600 dark:text-neutral-300">
                Archive this item? It will be removed from the outline. Restore it anytime from course
                settings under Archived content.
              </p>
              {archiveConfirmItem.title ? (
                <p className="mt-2 text-sm font-medium text-slate-900 dark:text-neutral-100">
                  {archiveConfirmItem.title}
                </p>
              ) : null}
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setArchiveConfirmItem(null)}
                  disabled={busyChildItemId === archiveConfirmItem.id}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700/80"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void confirmArchiveChild()}
                  disabled={busyChildItemId === archiveConfirmItem.id}
                  className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-indigo-500 dark:hover:bg-indigo-400"
                >
                  {busyChildItemId === archiveConfirmItem.id ? 'Archiving…' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </LmsPage>
  )
}
