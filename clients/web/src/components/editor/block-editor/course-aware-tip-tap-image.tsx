/* eslint-disable react-refresh/only-export-components -- TipTap extension + internal node view */
import Image from '@tiptap/extension-image'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { authorizedFetch } from '../../../lib/api'
import {
  needsAuthenticatedCourseImageSrc,
  resolveAuthorizedFetchPath,
  stripImageDisplayFragment,
} from '../../../lib/course-file-image'

const MIN_DISPLAY = 48

function CourseImageNodeView(props: NodeViewProps) {
  const { node, updateAttributes, selected } = props
  const src = (node.attrs.src as string) ?? ''
  const alt = (node.attrs.alt as string) ?? ''
  const widthAttr = node.attrs.width as number | null | undefined
  const heightAttr = node.attrs.height as number | null | undefined

  const imgRef = useRef<HTMLImageElement>(null)
  const dragRef = useRef<{
    startDist: number
    baseW: number
    baseH: number
    aspect: number
  } | null>(null)
  const latestDragSize = useRef<{ w: number; h: number } | null>(null)

  const [url, setUrl] = useState<string | null>(() =>
    src && !needsAuthenticatedCourseImageSrc(src) ? src : null,
  )
  /** Live pixel size while dragging a corner (committed on pointerup). */
  const [dragSize, setDragSize] = useState<{ w: number; h: number } | null>(null)

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- sync URL clear / direct src before async blob fetch */
    let cancelled = false
    let blobUrl: string | null = null
    if (!src) {
      setUrl(null)
      return
    }
    if (!needsAuthenticatedCourseImageSrc(src)) {
      setUrl(src)
      return
    }
    /* eslint-enable react-hooks/set-state-in-effect */
    const path = resolveAuthorizedFetchPath(src)
    void authorizedFetch(path)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status))
        return r.blob()
      })
      .then((blob) => {
        if (cancelled) return
        blobUrl = URL.createObjectURL(blob)
        setUrl(blobUrl)
      })
      .catch(() => {
        if (!cancelled) setUrl(null)
      })
    return () => {
      cancelled = true
      if (blobUrl) URL.revokeObjectURL(blobUrl)
    }
  }, [src])

  const effectiveW = dragSize?.w ?? widthAttr
  const effectiveH = dragSize?.h ?? heightAttr

  const beginCornerScale = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const img = imgRef.current
      if (!img || !url) return
      const rect = img.getBoundingClientRect()
      const w0 = typeof widthAttr === 'number' && widthAttr > 0 ? widthAttr : rect.width
      const h0 = typeof heightAttr === 'number' && heightAttr > 0 ? heightAttr : rect.height
      if (w0 < 4 || h0 < 4) return
      const aspect = w0 / h0
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      const startDist = Math.max(
        Math.hypot(e.clientX - cx, e.clientY - cy),
        Math.max(w0, h0) * 0.08,
      )
      dragRef.current = { startDist, baseW: w0, baseH: h0, aspect }
      latestDragSize.current = { w: w0, h: h0 }
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)

      const onMove = (ev: PointerEvent) => {
        const d = dragRef.current
        if (!d) return
        const dist = Math.hypot(ev.clientX - cx, ev.clientY - cy)
        let ratio = dist / d.startDist
        ratio = Math.max(ratio, MIN_DISPLAY / Math.max(d.baseW, d.baseH))
        const nw = Math.round(d.baseW * ratio)
        const nh = Math.round(nw / d.aspect)
        const next = { w: Math.max(MIN_DISPLAY, nw), h: Math.max(MIN_DISPLAY, nh) }
        latestDragSize.current = next
        setDragSize(next)
      }

      const onUp = (ev: PointerEvent) => {
        dragRef.current = null
        try {
          ;(e.target as HTMLElement).releasePointerCapture(ev.pointerId)
        } catch {
          /* ignore */
        }
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
        const fin = latestDragSize.current
        latestDragSize.current = null
        if (fin) {
          updateAttributes({ width: fin.w, height: fin.h })
        }
        setDragSize(null)
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    },
    [heightAttr, updateAttributes, url, widthAttr],
  )

  const handleClass =
    'absolute z-10 h-2.5 w-2.5 rounded-sm border border-white bg-indigo-500 shadow ring-1 ring-indigo-600/40 pointer-events-auto touch-none'

  return (
    <NodeViewWrapper as="figure" className="group/image-node relative my-3 flex justify-center [&_img]:rounded-lg">
      <div className="relative inline-block max-w-full">
        {url ? (
          <img
            ref={imgRef}
            src={url}
            alt={alt}
            draggable={false}
            data-drag-handle=""
            className="box-border max-w-full rounded-lg border border-slate-200 dark:border-neutral-700"
            style={
              typeof effectiveW === 'number' && typeof effectiveH === 'number'
                ? {
                    width: effectiveW,
                    height: effectiveH,
                    objectFit: 'contain',
                    display: 'block',
                  }
                : { maxWidth: '100%', height: 'auto', display: 'block' }
            }
          />
        ) : (
          <span className="text-sm text-slate-500 dark:text-neutral-400">Loading image…</span>
        )}

        {selected && url ? (
          <>
            <div
              className="pointer-events-none absolute inset-0 rounded-lg ring-2 ring-indigo-500 ring-offset-2 ring-offset-white dark:ring-offset-neutral-950"
              aria-hidden
            />
            <button
              type="button"
              aria-label="Resize image from corner"
              title="Drag to resize"
              className={`${handleClass} -left-1.5 -top-1.5 cursor-nwse-resize`}
              onPointerDown={beginCornerScale}
            />
            <button
              type="button"
              aria-label="Resize image from corner"
              title="Drag to resize"
              className={`${handleClass} -right-1.5 -top-1.5 cursor-nesw-resize`}
              onPointerDown={beginCornerScale}
            />
            <button
              type="button"
              aria-label="Resize image from corner"
              title="Drag to resize"
              className={`${handleClass} -bottom-1.5 -left-1.5 cursor-nesw-resize`}
              onPointerDown={beginCornerScale}
            />
            <button
              type="button"
              aria-label="Resize image from corner"
              title="Drag to resize"
              className={`${handleClass} -bottom-1.5 -right-1.5 cursor-nwse-resize`}
              onPointerDown={beginCornerScale}
            />
          </>
        ) : null}
      </div>
    </NodeViewWrapper>
  )
}

export const CourseAwareTipTapImage = Image.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CourseImageNodeView)
  },

  renderMarkdown(node) {
    const a = node.attrs ?? {}
    const alt = (a.alt as string | null | undefined) ?? ''
    const title = (a.title as string | null | undefined) ?? ''
    const width = a.width as number | null | undefined
    const height = a.height as number | null | undefined
    let src = (a.src as string | null | undefined) ?? ''
    const base = stripImageDisplayFragment(src).base
    src = base
    if (
      typeof width === 'number' &&
      typeof height === 'number' &&
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      width > 0 &&
      height > 0
    ) {
      src = `${base}#w=${Math.round(width)}&h=${Math.round(height)}`
    }
    const dest = title ? `${src} "${title.replace(/"/g, '\\"')}"` : src
    return `![${alt}](${dest})`
  },

  parseMarkdown(token, helpers) {
    const href = (token as { href?: string }).href ?? ''
    const { base, displayWidth, displayHeight } = stripImageDisplayFragment(href)
    return helpers.createNode('image', {
      src: base,
      alt: (token as { text?: string }).text ?? '',
      title: (token as { title?: string | null }).title ?? null,
      width: displayWidth ?? null,
      height: displayHeight ?? null,
    })
  },
})
