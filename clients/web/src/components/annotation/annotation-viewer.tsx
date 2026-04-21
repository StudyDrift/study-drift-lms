import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { apiUrl, authorizedFetch } from '../../lib/api'
import { getAccessToken } from '../../lib/auth'
import type { SubmissionAnnotationApi } from '../../lib/courses-api'
import type { AnnotationTool } from './annotation-toolbar'

GlobalWorkerOptions.workerSrc = workerSrc

type NormPoint = { x: number; y: number }
type NormRect = { x1: number; y1: number; x2: number; y2: number }

export type AnnotationViewerProps = {
  filePath: string | null
  mimeType: string | null
  readOnly: boolean
  tool: AnnotationTool
  colour: string
  annotations: SubmissionAnnotationApi[]
  onHighlightComplete?: (page: number, rect: NormRect) => void
  onDrawComplete?: (page: number, points: NormPoint[]) => void
  onPinComplete?: (page: number, pt: NormPoint) => void
  onTextBoxComplete?: (page: number, rect: NormRect) => void
}

function normFromClient(rect: DOMRect, clientX: number, clientY: number): NormPoint {
  const nx = (clientX - rect.left) / rect.width
  const ny = (clientY - rect.top) / rect.height
  return {
    x: Math.min(1, Math.max(0, nx)),
    y: Math.min(1, Math.max(0, ny)),
  }
}

function parseHighlight(c: unknown): NormRect | null {
  if (!c || typeof c !== 'object') return null
  const o = c as Record<string, unknown>
  const x1 = typeof o.x1 === 'number' ? o.x1 : Number(o.x1)
  const y1 = typeof o.y1 === 'number' ? o.y1 : Number(o.y1)
  const x2 = typeof o.x2 === 'number' ? o.x2 : Number(o.x2)
  const y2 = typeof o.y2 === 'number' ? o.y2 : Number(o.y2)
  if (![x1, y1, x2, y2].every((n) => Number.isFinite(n))) return null
  return { x1, y1, x2, y2 }
}

function parsePoints(c: unknown): NormPoint[] {
  if (!c || typeof c !== 'object') return []
  const o = c as { points?: unknown }
  if (!Array.isArray(o.points)) return []
  const out: NormPoint[] = []
  for (const p of o.points) {
    if (!p || typeof p !== 'object') continue
    const r = p as Record<string, unknown>
    const x = typeof r.x === 'number' ? r.x : Number(r.x)
    const y = typeof r.y === 'number' ? r.y : Number(r.y)
    if (Number.isFinite(x) && Number.isFinite(y)) out.push({ x, y })
  }
  return out
}

function parsePin(c: unknown): NormPoint | null {
  if (!c || typeof c !== 'object') return null
  const o = c as Record<string, unknown>
  const x = typeof o.x === 'number' ? o.x : Number(o.x)
  const y = typeof o.y === 'number' ? o.y : Number(o.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return { x, y }
}

function PageOverlay({
  page,
  width,
  height,
  annotations,
  readOnly,
  tool,
  colour,
  onHighlightComplete,
  onDrawComplete,
  onPinComplete,
  onTextBoxComplete,
}: {
  page: number
  width: number
  height: number
  annotations: SubmissionAnnotationApi[]
  readOnly: boolean
  tool: AnnotationTool
  colour: string
  onHighlightComplete?: (page: number, rect: NormRect) => void
  onDrawComplete?: (page: number, points: NormPoint[]) => void
  onPinComplete?: (page: number, pt: NormPoint) => void
  onTextBoxComplete?: (page: number, rect: NormRect) => void
}) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [drag, setDrag] = useState<
    | { kind: 'highlight' | 'draw' | 'text'; start: NormPoint; cur: NormPoint; pts: NormPoint[] }
    | { kind: 'pin'; start: NormPoint }
    | null
  >(null)

  const annForPage = useMemo(() => annotations.filter((a) => a.page === page), [annotations, page])

  const onPointerDown = (e: React.PointerEvent) => {
    if (readOnly || !rootRef.current) return
    if (tool === 'select') return
    const rect = rootRef.current.getBoundingClientRect()
    const p = normFromClient(rect, e.clientX, e.clientY)
    if (tool === 'highlight' || tool === 'text') {
      setDrag({ kind: tool, start: p, cur: p, pts: [p] })
    } else if (tool === 'draw') {
      setDrag({ kind: 'draw', start: p, cur: p, pts: [p] })
    } else if (tool === 'pin') {
      setDrag({ kind: 'pin', start: p })
    }
    rootRef.current.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag || readOnly || !rootRef.current) return
    const rect = rootRef.current.getBoundingClientRect()
    const p = normFromClient(rect, e.clientX, e.clientY)
    if (drag.kind === 'pin') return
    if (drag.kind === 'draw') {
      setDrag((d) => {
        if (!d || d.kind !== 'draw') return d
        const last = d.pts[d.pts.length - 1]
        if (last && Math.hypot(p.x - last.x, p.y - last.y) < 0.002) return d
        return { ...d, cur: p, pts: [...d.pts, p] }
      })
    } else {
      setDrag((d) => (d && d.kind !== 'pin' ? { ...d, cur: p } : d))
    }
  }

  const finish = (e: React.PointerEvent) => {
    if (!drag || readOnly || !rootRef.current) return
    const rect = rootRef.current.getBoundingClientRect()
    const p = normFromClient(rect, e.clientX, e.clientY)
    try {
      rootRef.current.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    if (drag.kind === 'pin') {
      onPinComplete?.(page, drag.start)
      setDrag(null)
      return
    }
    if (drag.kind === 'draw') {
      const pts = drag.pts.length >= 2 ? drag.pts : [...drag.pts, p]
      if (pts.length >= 2) onDrawComplete?.(page, pts)
      setDrag(null)
      return
    }
    const x1 = Math.min(drag.start.x, p.x)
    const x2 = Math.max(drag.start.x, p.x)
    const y1 = Math.min(drag.start.y, p.y)
    const y2 = Math.max(drag.start.y, p.y)
    if (Math.abs(x2 - x1) < 0.002 && Math.abs(y2 - y1) < 0.002) {
      setDrag(null)
      return
    }
    if (drag.kind === 'highlight') {
      onHighlightComplete?.(page, { x1, y1, x2, y2 })
    } else if (drag.kind === 'text') {
      onTextBoxComplete?.(page, { x1, y1, x2, y2 })
    }
    setDrag(null)
  }

  const draftRect =
    drag && drag.kind !== 'pin' && drag.kind !== 'draw'
      ? {
          x1: Math.min(drag.start.x, drag.cur.x),
          y1: Math.min(drag.start.y, drag.cur.y),
          x2: Math.max(drag.start.x, drag.cur.x),
          y2: Math.max(drag.start.y, drag.cur.y),
        }
      : null

  const interact = !readOnly && tool !== 'select'

  return (
    <div
      ref={rootRef}
      className="absolute inset-0"
      style={{ width, height }}
    >
      <svg
        width={width}
        height={height}
        className={interact ? 'touch-none' : 'pointer-events-none'}
        style={{ pointerEvents: interact ? 'auto' : 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={() => setDrag(null)}
        role="img"
        aria-label={`Annotations page ${page}`}
      >
        {annForPage.map((a) => {
          if (a.toolType === 'highlight') {
            const r = parseHighlight(a.coordsJson)
            if (!r) return null
            const sx = Math.min(r.x1, r.x2) * width
            const sy = Math.min(r.y1, r.y2) * height
            const sw = Math.abs(r.x2 - r.x1) * width
            const sh = Math.abs(r.y2 - r.y1) * height
            return (
              <rect
                key={a.id}
                x={sx}
                y={sy}
                width={sw}
                height={sh}
                fill={a.colour}
                fillOpacity={0.35}
                stroke={a.colour}
                strokeWidth={1}
              />
            )
          }
          if (a.toolType === 'draw') {
            const pts = parsePoints(a.coordsJson)
            if (pts.length < 2) return null
            const d = pts
              .map((q, i) => `${i === 0 ? 'M' : 'L'} ${q.x * width} ${q.y * height}`)
              .join(' ')
            return (
              <path
                key={a.id}
                d={d}
                fill="none"
                stroke={a.colour}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )
          }
          if (a.toolType === 'pin') {
            const pt = parsePin(a.coordsJson)
            if (!pt) return null
            const cx = pt.x * width
            const cy = pt.y * height
            const s = Math.max(6, Math.min(width, height) * 0.02)
            return <circle key={a.id} cx={cx} cy={cy} r={s} fill={a.colour} fillOpacity={0.85} />
          }
          if (a.toolType === 'text') {
            const r = parseHighlight(a.coordsJson)
            if (!r) return null
            const sx = Math.min(r.x1, r.x2) * width
            const sy = Math.min(r.y1, r.y2) * height
            const sw = Math.abs(r.x2 - r.x1) * width
            const sh = Math.abs(r.y2 - r.y1) * height
            return (
              <rect
                key={a.id}
                x={sx}
                y={sy}
                width={sw}
                height={sh}
                fill="none"
                stroke={a.colour}
                strokeDasharray="4 3"
                strokeWidth={1.5}
              />
            )
          }
          return null
        })}
        {draftRect ? (
          <rect
            x={draftRect.x1 * width}
            y={draftRect.y1 * height}
            width={(draftRect.x2 - draftRect.x1) * width}
            height={(draftRect.y2 - draftRect.y1) * height}
            fill={colour}
            fillOpacity={0.25}
          />
        ) : null}
        {drag && drag.kind === 'draw' && drag.pts.length > 1 ? (
          <path
            d={drag.pts.map((q, i) => `${i === 0 ? 'M' : 'L'} ${q.x * width} ${q.y * height}`).join(' ')}
            fill="none"
            stroke={colour}
            strokeWidth={2}
          />
        ) : null}
      </svg>
    </div>
  )
}

const PDF_SCALE = 1.2

export function AnnotationViewer({
  filePath,
  mimeType,
  readOnly,
  tool,
  colour,
  annotations,
  onHighlightComplete,
  onDrawComplete,
  onPinComplete,
  onTextBoxComplete,
}: AnnotationViewerProps) {
  const [error, setError] = useState<string | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [imageDisplaySize, setImageDisplaySize] = useState({ w: 400, h: 300 })
  const [pageLayouts, setPageLayouts] = useState<{ n: number; w: number; h: number }[]>([])
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([])
  const pageObjsRef = useRef<Awaited<ReturnType<PDFDocumentProxy['getPage']>>[]>([])

  useEffect(() => {
    if (!filePath || !mimeType) return undefined
    const fp = filePath
    const mt = mimeType

    let cancelled = false
    let blobUrl: string | null = null
    let loadedPdf: PDFDocumentProxy | null = null

    async function run() {
      setError(null)
      setPageLayouts([])
      pageObjsRef.current = []
      setImageUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return null
      })

      try {
        if (mt === 'application/pdf') {
          const token = getAccessToken()
          const doc = await getDocument({
            url: apiUrl(fp),
            httpHeaders: token ? { Authorization: `Bearer ${token}` } : undefined,
            withCredentials: false,
          }).promise
          if (cancelled) {
            await doc.destroy().catch(() => {})
            return
          }
          loadedPdf = doc
          const layouts: { n: number; w: number; h: number }[] = []
          const pages: Awaited<ReturnType<PDFDocumentProxy['getPage']>>[] = []
          for (let i = 1; i <= doc.numPages; i += 1) {
            const page = await doc.getPage(i)
            const vp = page.getViewport({ scale: PDF_SCALE })
            layouts.push({ n: i, w: vp.width, h: vp.height })
            pages.push(page)
          }
          if (!cancelled) {
            pageObjsRef.current = pages
            setPageLayouts(layouts)
          }
        } else if (mt.startsWith('image/')) {
          const res = await authorizedFetch(fp)
          if (!res.ok) throw new Error('Could not load image.')
          const blob = await res.blob()
          if (cancelled) return
          blobUrl = URL.createObjectURL(blob)
          setImageUrl(blobUrl)
        } else {
          setError('Preview is only available for PDF and image submissions.')
        }
      } catch {
        if (!cancelled) setError('Could not load submission. Retry?')
      }
    }

    void run()
    return () => {
      cancelled = true
      if (blobUrl) URL.revokeObjectURL(blobUrl)
      if (loadedPdf) void loadedPdf.destroy().catch(() => {})
    }
  }, [filePath, mimeType])

  const renderPdfPages = useCallback(async () => {
    const pages = pageObjsRef.current
    if (!pages.length) return
    await Promise.all(
      pages.map(async (page, idx) => {
        const canvas = canvasRefs.current[idx]
        if (!canvas) return
        const vp = page.getViewport({ scale: PDF_SCALE })
        canvas.width = vp.width
        canvas.height = vp.height
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        await page.render({ canvasContext: ctx, viewport: vp }).promise
      }),
    )
  }, [])

  useEffect(() => {
    if (!pageLayouts.length) return
    void renderPdfPages()
  }, [pageLayouts, renderPdfPages])

  if (!filePath || !mimeType) {
    return (
      <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
        No file on this submission yet.
      </p>
    )
  }

  if (error) {
    return (
      <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-6 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200">
        {error}
      </p>
    )
  }

  if (imageUrl) {
    const imageReadOnly = true
    return (
      <div className="max-h-[80vh] overflow-auto rounded-xl border border-slate-200 bg-white dark:border-neutral-700 dark:bg-neutral-950">
        <div className="relative inline-block max-w-full">
          <img
            src={imageUrl}
            alt="Submission"
            className="block h-auto max-h-[80vh] max-w-full object-contain"
            onLoad={(e) => {
              const el = e.currentTarget
              setImageDisplaySize({ w: el.offsetWidth || 400, h: el.offsetHeight || 300 })
            }}
          />
          <PageOverlay
            page={1}
            width={imageDisplaySize.w}
            height={imageDisplaySize.h}
            annotations={annotations}
            readOnly={readOnly || imageReadOnly}
            tool={tool}
            colour={colour}
            onHighlightComplete={onHighlightComplete}
            onDrawComplete={onDrawComplete}
            onPinComplete={onPinComplete}
            onTextBoxComplete={onTextBoxComplete}
          />
        </div>
        <p className="border-t border-slate-200 px-3 py-2 text-xs text-slate-500 dark:border-neutral-700 dark:text-neutral-400">
          Image submissions show annotations as an overlay preview. Use PDF uploads for full in-browser marking.
        </p>
      </div>
    )
  }

  if (!pageLayouts.length) {
    return <p className="text-sm text-slate-500 dark:text-neutral-400">Loading PDF…</p>
  }

  return (
    <div className="max-h-[80vh] space-y-4 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50/50 p-3 dark:border-neutral-700 dark:bg-neutral-950/40">
      {pageLayouts.map((pv, idx) => (
        <div key={pv.n} className="relative mx-auto inline-block max-w-full shadow-sm">
          <canvas
            ref={(el) => {
              canvasRefs.current[idx] = el
            }}
            className="block max-w-full bg-white dark:bg-neutral-950"
          />
          <PageOverlay
            page={pv.n}
            width={pv.w}
            height={pv.h}
            annotations={annotations}
            readOnly={readOnly}
            tool={tool}
            colour={colour}
            onHighlightComplete={onHighlightComplete}
            onDrawComplete={onDrawComplete}
            onPinComplete={onPinComplete}
            onTextBoxComplete={onTextBoxComplete}
          />
        </div>
      ))}
    </div>
  )
}
