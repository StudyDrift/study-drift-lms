import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
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
import { CircleHelp, ClipboardList, Eye, EyeOff, FileText, GripVertical, Heading, Settings } from 'lucide-react'
import { AddCourseItemMenu } from './AddCourseItemMenu'
import { AddModuleItemMenu, type ModuleItemKind } from './AddModuleItemMenu'
import { CourseModulesAiPanel } from './CourseModulesAiPanel'
import { LmsPage } from './LmsPage'
import { ModuleNameModal } from './ModuleNameModal'
import { ModuleSettingsModal } from './ModuleSettingsModal'
import { RequirePermission } from '../../components/RequirePermission'
import { usePermissions } from '../../context/usePermissions'
import {
  createCourseModule,
  createModuleAssignment,
  createModuleContentPage,
  createModuleHeading,
  createModuleQuiz,
  fetchCourseStructure,
  patchCourseModule,
  reorderCourseStructure,
  type CourseStructureItem,
} from '../../lib/coursesApi'
import { permCourseItemCreate } from '../../lib/rbacApi'

const MODULE_SORT_ID = 'sortable-modules'

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
            i.kind === 'quiz'),
      )
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((c) => c.id)
  }
  return { moduleOrder, childOrderByModule }
}

function ChildRowContent({ child, courseCode }: { child: CourseStructureItem; courseCode: string }) {
  return (
    <>
      {child.kind === 'content_page' ? (
        <div className="flex items-center gap-3">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-indigo-200/80 bg-indigo-50 text-indigo-600 dark:border-indigo-500/35 dark:bg-indigo-950/60 dark:text-indigo-300"
            aria-hidden
          >
            <FileText className="h-4 w-4" strokeWidth={2} />
          </span>
          <Link
            to={`/courses/${encodeURIComponent(courseCode)}/modules/content/${encodeURIComponent(child.id)}`}
            className="min-w-0 pl-3 text-base font-semibold leading-snug tracking-tight text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300"
          >
            {child.title}
          </Link>
        </div>
      ) : child.kind === 'assignment' ? (
        <div className="flex items-center gap-3">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber-200/90 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-950/50 dark:text-amber-200"
            aria-hidden
          >
            <ClipboardList className="h-4 w-4" strokeWidth={2} />
          </span>
          <Link
            to={`/courses/${encodeURIComponent(courseCode)}/modules/assignment/${encodeURIComponent(child.id)}`}
            className="min-w-0 pl-3 text-base font-semibold leading-snug tracking-tight text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300"
          >
            {child.title}
          </Link>
        </div>
      ) : child.kind === 'quiz' ? (
        <div className="flex items-center gap-3">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-emerald-200/90 bg-emerald-50 text-emerald-700"
            aria-hidden
          >
            <CircleHelp className="h-4 w-4" strokeWidth={2} />
          </span>
          <Link
            to={`/courses/${encodeURIComponent(courseCode)}/modules/quiz/${encodeURIComponent(child.id)}`}
            className="min-w-0 pl-3 text-base font-semibold leading-snug tracking-tight text-indigo-600 hover:text-indigo-500"
          >
            {child.title}
          </Link>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400"
            aria-hidden
          >
            <Heading className="h-4 w-4" strokeWidth={2} />
          </span>
          <p className="min-w-0 text-xl font-bold leading-snug tracking-tight text-slate-950 dark:text-slate-100">
            {child.title}
          </p>
        </div>
      )}
    </>
  )
}

type SortableChildRowProps = {
  child: CourseStructureItem
  courseCode: string
  disabled: boolean
  moduleId: string
}

function SortableChildRow({ child, courseCode, disabled, moduleId }: SortableChildRowProps) {
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

  return (
    <li ref={setNodeRef} style={style} className="py-3 first:pt-0">
      <div className="flex items-start gap-2">
        {!disabled && (
          <button
            type="button"
            className="mt-0.5 flex h-9 w-9 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg border-0 bg-transparent p-0 text-slate-400 shadow-none transition hover:text-slate-600 active:cursor-grabbing dark:text-slate-500 dark:hover:text-slate-300"
            aria-label="Drag to reorder item"
            {...listeners}
            {...attributes}
          >
            <GripVertical className="h-4 w-4" strokeWidth={2} aria-hidden />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <ChildRowContent child={child} courseCode={courseCode} />
        </div>
      </div>
    </li>
  )
}

function StaticChildRow({ child, courseCode }: { child: CourseStructureItem; courseCode: string }) {
  return (
    <li className="py-3 first:pt-0">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <ChildRowContent child={child} courseCode={courseCode} />
        </div>
      </div>
    </li>
  )
}

type ModuleCardBodyProps = {
  item: CourseStructureItem
  courseCode: string
  moduleChildrenById: Map<string, CourseStructureItem[]>
  canEditModules: boolean
  anyModalBusy: boolean
  onModuleItemAdd: (moduleId: string, kind: ModuleItemKind) => void
  minified: boolean
  busyModuleId: string | null
  onTogglePublished: (item: CourseStructureItem) => void
  onOpenModuleSettings: (item: CourseStructureItem) => void
  moduleDragHandle: ReactNode
  childrenList: ReactNode | null
}

function ModuleCardBody({
  item,
  courseCode,
  moduleChildrenById,
  canEditModules,
  anyModalBusy,
  onModuleItemAdd,
  minified,
  busyModuleId,
  onTogglePublished,
  onOpenModuleSettings,
  moduleDragHandle,
  childrenList,
}: ModuleCardBodyProps) {
  const children = moduleChildrenById.get(item.id) ?? []
  return (
    <div
      className={`w-full rounded-2xl border border-slate-200 bg-slate-50/80 shadow-sm dark:border-slate-700 dark:bg-slate-800/90 ${
        minified ? 'p-2.5' : 'p-4'
      }`}
    >
      <div className="flex flex-wrap items-start gap-2 sm:gap-3">
        {moduleDragHandle}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-950 dark:text-slate-100">{item.title}</p>
              {!minified && (
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Course activities and items can be grouped under this module.
                </p>
              )}
              {minified && children.length > 0 && (
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {children.length} {children.length === 1 ? 'item' : 'items'}
                </p>
              )}
            </div>
            {canEditModules && !minified && (
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-1 sm:gap-2">
                <RequirePermission permission={permCourseItemCreate(courseCode)} fallback={null}>
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
                    className={`flex h-9 w-9 items-center justify-center rounded-lg border shadow-none transition disabled:cursor-not-allowed disabled:opacity-50 ${
                      item.published
                        ? 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:border-indigo-500/40 dark:bg-indigo-950/60 dark:text-indigo-200 dark:hover:bg-indigo-950/90'
                        : 'border-slate-200 bg-white text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-500 dark:hover:bg-slate-700 dark:hover:text-slate-300'
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
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-none transition hover:bg-slate-100 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                  >
                    <Settings className="h-4 w-4" strokeWidth={2} aria-hidden />
                  </button>
                  <AddModuleItemMenu
                    onAdd={(kind) => onModuleItemAdd(item.id, kind)}
                    disabled={anyModalBusy}
                  />
                </RequirePermission>
              </div>
            )}
          </div>
        </div>
      </div>
      {!minified && children.length > 0 && childrenList}
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
  busyModuleId: string | null
  onTogglePublished: (item: CourseStructureItem) => void
  onOpenModuleSettings: (item: CourseStructureItem) => void
}

function SortableModuleCard({
  item,
  courseCode,
  moduleChildrenById,
  canEditModules,
  anyModalBusy,
  onModuleItemAdd,
  minified,
  busyModuleId,
  onTogglePublished,
  onOpenModuleSettings,
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
    !minified && children.length > 0 ? (
      <SortableContext
        id={`module-children-${item.id}`}
        items={childIds}
        strategy={verticalListSortingStrategy}
      >
        <ul className="mt-4 divide-y divide-slate-200/90 border-t border-slate-200/80 pt-4 dark:divide-slate-700 dark:border-slate-700">
          {children.map((child) => (
            <SortableChildRow
              key={child.id}
              child={child}
              courseCode={courseCode}
              moduleId={item.id}
              disabled={!canEditModules || anyModalBusy}
            />
          ))}
        </ul>
      </SortableContext>
    ) : null

  return (
    <li ref={setNodeRef} style={style} className="w-full">
      <ModuleCardBody
        item={item}
        courseCode={courseCode}
        moduleChildrenById={moduleChildrenById}
        canEditModules={canEditModules}
        anyModalBusy={anyModalBusy}
        onModuleItemAdd={onModuleItemAdd}
        minified={minified}
        busyModuleId={busyModuleId}
        onTogglePublished={onTogglePublished}
        onOpenModuleSettings={onOpenModuleSettings}
        moduleDragHandle={
          canEditModules ? (
            <button
              type="button"
              className="mt-0.5 flex h-9 w-9 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg border-0 bg-transparent p-0 text-slate-400 shadow-none transition hover:text-slate-600 active:cursor-grabbing dark:text-slate-500 dark:hover:text-slate-300"
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
  const children = moduleChildrenById.get(item.id) ?? []
  const childrenList =
    children.length > 0 ? (
      <ul className="mt-4 divide-y divide-slate-200/90 border-t border-slate-200/80 pt-4 dark:divide-slate-700 dark:border-slate-700">
        {children.map((child) => (
          <StaticChildRow key={child.id} child={child} courseCode={courseCode} />
        ))}
      </ul>
    ) : null

  return (
    <li className="w-full">
      <ModuleCardBody
        item={item}
        courseCode={courseCode}
        moduleChildrenById={moduleChildrenById}
        canEditModules={false}
        anyModalBusy={false}
        onModuleItemAdd={() => {}}
        minified={false}
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
  const [busyModuleId, setBusyModuleId] = useState<string | null>(null)
  const [moduleActionError, setModuleActionError] = useState<string | null>(null)
  const [moduleSettingsOpen, setModuleSettingsOpen] = useState(false)
  const [moduleSettingsKey, setModuleSettingsKey] = useState(0)
  const [moduleSettingsModuleId, setModuleSettingsModuleId] = useState<string | null>(null)
  const [moduleSettingsSaving, setModuleSettingsSaving] = useState(false)
  const [moduleSettingsSaveError, setModuleSettingsSaveError] = useState<string | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [courseDesignerOpen, setCourseDesignerOpen] = useState(false)

  const [isDraggingModule, setIsDraggingModule] = useState(false)
  const [activeDragId, setActiveDragId] = useState<string | null>(null)

  /** `course:<courseCode>:item:create` — structure edit, reorder, and add items (server: `course_grants::course_item_create_permission`). */
  const itemCreatePerm = courseCode ? permCourseItemCreate(courseCode) : ''
  const canEditModules = Boolean(
    courseCode && !permissionsLoading && !permissionsError && allows(itemCreatePerm),
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
    moduleSettingsSaving ||
    moduleSettingsOpen

  const anyModalBusy = blockingUi || aiBusy || reorderSaving

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const load = useCallback(async () => {
    if (!courseCode) return
    setLoading(true)
    setLoadError(null)
    setModuleActionError(null)
    try {
      const list = await fetchCourseStructure(courseCode)
      setItems(list)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load course structure.')
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [courseCode])

  useEffect(() => {
    void load()
  }, [load])

  const saveModule = useCallback(
    async (title: string) => {
      if (!courseCode) return
      setModuleSaveError(null)
      setModuleSaving(true)
      try {
        await createCourseModule(courseCode, { title })
        await load()
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
        await load()
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
        await load()
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
        await load()
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
        await load()
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
        await load()
      } catch (e) {
        setModuleActionError(e instanceof Error ? e.message : 'Could not update module.')
      } finally {
        setBusyModuleId(null)
      }
    },
    [courseCode, load],
  )

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
        await load()
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

  const moduleChildrenById = useMemo(() => {
    const m = new Map<string, CourseStructureItem[]>()
    for (const i of items) {
      if (
        (i.kind === 'heading' ||
          i.kind === 'content_page' ||
          i.kind === 'assignment' ||
          i.kind === 'quiz') &&
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
        await load()
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
        <p className="mt-6 text-sm text-slate-500 dark:text-slate-400">Invalid link.</p>
      </LmsPage>
    )
  }

  return (
    <LmsPage
      title="Modules"
      description={courseCode ? `Course ${courseCode}` : 'Course modules'}
      actions={
        courseCode ? (
          <RequirePermission permission={permCourseItemCreate(courseCode)} fallback={null}>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setCourseDesignerOpen((open) => !open)}
                disabled={anyModalBusy}
                aria-pressed={courseDesignerOpen}
                aria-expanded={courseDesignerOpen}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-slate-500 dark:hover:bg-slate-800"
              >
                Course Designer
              </button>
              <AddCourseItemMenu onAdd={openAddModule} disabled={anyModalBusy} />
            </div>
          </RequirePermission>
        ) : null
      }
    >
      {canEditModules && courseCode && courseDesignerOpen && (
        <RequirePermission permission={permCourseItemCreate(courseCode)} fallback={null}>
          <CourseModulesAiPanel
            courseCode={courseCode}
            onApplied={(next) => setItems(next)}
            disabled={blockingUi}
            onBusyChange={setAiBusy}
          />
        </RequirePermission>
      )}
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
      {loading && <p className="mt-8 text-sm text-slate-500 dark:text-slate-400">Loading modules…</p>}
      {!loading && showViewerOnlyHint && (
        <p className="mt-8 text-sm text-slate-500 dark:text-slate-400">
          You can view this outline, but only the course creator and assigned course teachers can add
          modules.
        </p>
      )}
      {empty && canEditModules && (
        <p className="mt-8 text-sm text-slate-500 dark:text-slate-400">
          No course items yet. Use{' '}
          <span className="font-medium text-slate-700 dark:text-slate-300">Add Course Item</span> to add a module.
        </p>
      )}
      {empty && !canEditModules && (
        <p className="mt-8 text-sm text-slate-500 dark:text-slate-400">No modules yet.</p>
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
                  <p className="text-base font-semibold tracking-tight text-slate-950 dark:text-slate-100">
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
                    busyModuleId={busyModuleId}
                    onTogglePublished={handleTogglePublished}
                    onOpenModuleSettings={handleOpenModuleSettings}
                  />
                ))}
            </ul>
          </SortableContext>
          {/* DragOverlay disables node rect-delta compensation; collapsing modules shifts layout and
              desyncs the overlay from the cursor. Only use DragOverlay for in-module item drags. */}
          {activeDragId && activeItem && activeItem.kind !== 'module' ? (
            <DragOverlay dropAnimation={null}>
              <div className="pointer-events-none max-w-lg rounded-xl border border-slate-300 bg-white px-3 py-2 shadow-lg dark:border-slate-600 dark:bg-slate-800">
                <p className="text-sm font-semibold text-slate-950 dark:text-slate-100">{activeItem.title}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {activeItem.kind === 'content_page'
                    ? 'Page'
                    : activeItem.kind === 'assignment'
                      ? 'Assignment'
                      : activeItem.kind === 'quiz'
                        ? 'Quiz'
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
                  <p className="text-base font-semibold tracking-tight text-slate-950 dark:text-slate-100">
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
    </LmsPage>
  )
}
