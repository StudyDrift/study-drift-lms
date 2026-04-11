import { getAccessToken } from './auth'
import { newNotebookPageId, updatePageContent, type CourseNotebookPage } from './courseNotebookTree'
import { decodeJwtSub } from './jwtPayload'

export type { CourseNotebookPage } from './courseNotebookTree'

export const STUDENT_NOTEBOOKS_CHANGED = 'lextures-student-notebooks-changed'

/** Legacy v1 row (single body). */
export type StudentCourseNotebookLegacy = {
  body: string
  updatedAt: string
  courseTitle?: string
}

export type CourseNotebookStore = {
  formatVersion: 2
  updatedAt: string
  courseTitle?: string
  pages: CourseNotebookPage[]
  activePageId: string | null
}

type StoreFile = {
  notebooks: Record<string, unknown>
}

function ownerKey(): string {
  return decodeJwtSub(getAccessToken()) ?? 'anonymous'
}

function storageKey(): string {
  return `lextures.studentNotebooks.v1:${ownerKey()}`
}

function readFile(): StoreFile {
  try {
    const raw = localStorage.getItem(storageKey())
    if (!raw) return { notebooks: {} }
    const parsed = JSON.parse(raw) as StoreFile
    if (!parsed || typeof parsed !== 'object' || typeof parsed.notebooks !== 'object') {
      return { notebooks: {} }
    }
    return { notebooks: parsed.notebooks }
  } catch {
    return { notebooks: {} }
  }
}

function writeFile(data: StoreFile): void {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(data))
  } catch {
    /* ignore quota / private mode */
  }
}

function emitChanged(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(STUDENT_NOTEBOOKS_CHANGED))
}

function normalizeActivePage(data: CourseNotebookStore): CourseNotebookStore {
  const first = data.pages[0]?.id ?? null
  const valid =
    data.activePageId && data.pages.some((p) => p.id === data.activePageId) ? data.activePageId : first
  return { ...data, activePageId: valid }
}

function migrateLegacyToV2(row: StudentCourseNotebookLegacy): CourseNotebookStore {
  const id = newNotebookPageId()
  const body = typeof row.body === 'string' ? row.body : ''
  return normalizeActivePage({
    formatVersion: 2,
    updatedAt: row.updatedAt ?? new Date().toISOString(),
    courseTitle: row.courseTitle,
    pages: [{ id, title: 'Notes', parentId: null, sortOrder: 0, contentMd: body }],
    activePageId: id,
  })
}

function emptyNotebook(): CourseNotebookStore {
  const id = newNotebookPageId()
  return {
    formatVersion: 2,
    updatedAt: new Date().toISOString(),
    pages: [{ id, title: 'Untitled', parentId: null, sortOrder: 0, contentMd: '' }],
    activePageId: id,
  }
}

function parseStoredNotebookRow(raw: unknown): CourseNotebookStore {
  if (!raw || typeof raw !== 'object') return emptyNotebook()
  const r = raw as Record<string, unknown>
  if (r.formatVersion === 2 && Array.isArray(r.pages) && r.pages.length > 0) {
    const pages = (r.pages as unknown[]).map((p) => {
      const row = p as Record<string, unknown>
      return {
        id: String(row.id ?? newNotebookPageId()),
        title: typeof row.title === 'string' ? row.title : 'Untitled',
        parentId: row.parentId === null || typeof row.parentId === 'string' ? (row.parentId as string | null) : null,
        sortOrder: typeof row.sortOrder === 'number' ? row.sortOrder : 0,
        contentMd: typeof row.contentMd === 'string' ? row.contentMd : '',
      } satisfies CourseNotebookPage
    })
    return normalizeActivePage({
      formatVersion: 2,
      updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : new Date().toISOString(),
      courseTitle: typeof r.courseTitle === 'string' ? r.courseTitle : undefined,
      pages,
      activePageId: typeof r.activePageId === 'string' ? r.activePageId : null,
    })
  }
  return migrateLegacyToV2(raw as StudentCourseNotebookLegacy)
}

export function loadCourseNotebook(courseCode: string): CourseNotebookStore {
  const row = readFile().notebooks[courseCode]
  if (!row) return emptyNotebook()
  return parseStoredNotebookRow(row)
}

export function saveCourseNotebookStore(courseCode: string, data: CourseNotebookStore): void {
  const file = readFile()
  const next: CourseNotebookStore = {
    ...data,
    updatedAt: new Date().toISOString(),
  }
  file.notebooks[courseCode] = next
  writeFile(file)
  emitChanged()
}

/** Preview for My Notebooks: any non-empty markdown across pages. */
export function getStudentCourseNotebook(courseCode: string): StudentCourseNotebookLegacy | null {
  const raw = readFile().notebooks[courseCode]
  if (!raw) return null
  const data = parseStoredNotebookRow(raw)
  const body = data.pages.map((p) => p.contentMd).join('\n\n').trim()
  if (body.length === 0) return null
  return {
    body: data.pages.map((p) => p.contentMd).join('\n\n'),
    updatedAt: data.updatedAt,
    courseTitle: data.courseTitle,
  }
}

export function listStudentCourseNotebooks(): Record<string, StudentCourseNotebookLegacy> {
  const file = readFile()
  const out: Record<string, StudentCourseNotebookLegacy> = {}
  for (const code of Object.keys(file.notebooks)) {
    const prev = getStudentCourseNotebook(code)
    if (prev) out[code] = prev
  }
  return out
}

/** Append a quoted excerpt from a content page into a notebook page (local storage). */
export function appendContentQuoteToNotebookPage(
  courseCode: string,
  notebookPageId: string,
  fragment: { sourcePageTitle: string; quoteText: string; userNote?: string },
): void {
  const data = loadCourseNotebook(courseCode)
  const page = data.pages.find((p) => p.id === notebookPageId)
  if (!page) return
  const titleLine = fragment.sourcePageTitle.replace(/\s+/g, ' ').trim() || 'Content page'
  const quoteMd = fragment.quoteText
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
  const noteBlock =
    fragment.userNote?.trim() !== ''
      ? `\n\n${fragment.userNote!.trim()}\n`
      : '\n'
  const block = `\n\n---\n\n**From:** *${titleLine}*\n\n${quoteMd}${noteBlock}`
  const pages = updatePageContent(data.pages, notebookPageId, `${page.contentMd}${block}`)
  saveCourseNotebookStore(courseCode, { ...data, pages })
}

export function subscribeStudentNotebooks(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  function onStorage(e: StorageEvent) {
    if (e.key === storageKey()) onChange()
  }
  function onCustom() {
    onChange()
  }
  window.addEventListener('storage', onStorage)
  window.addEventListener(STUDENT_NOTEBOOKS_CHANGED, onCustom)
  return () => {
    window.removeEventListener('storage', onStorage)
    window.removeEventListener(STUDENT_NOTEBOOKS_CHANGED, onCustom)
  }
}

