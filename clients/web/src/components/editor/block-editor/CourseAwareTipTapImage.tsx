/* eslint-disable react-refresh/only-export-components -- TipTap extension + internal node view */
import Image from '@tiptap/extension-image'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { useEffect, useState } from 'react'
import { authorizedFetch } from '../../../lib/api'
import { needsAuthenticatedCourseImageSrc, resolveAuthorizedFetchPath } from '../../../lib/courseFileImage'

function CourseImageNodeView(props: NodeViewProps) {
  const src = (props.node.attrs as { src?: string }).src ?? ''
  const alt = (props.node.attrs as { alt?: string }).alt ?? ''
  const [url, setUrl] = useState<string | null>(() =>
    src && !needsAuthenticatedCourseImageSrc(src) ? src : null,
  )

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

  return (
    <NodeViewWrapper as="figure" className="my-3 [&_img]:max-w-full [&_img]:rounded-lg" data-drag-handle="">
      {url ? (
        <img
          src={url}
          alt={alt}
          className="max-w-full rounded-lg border border-slate-200 dark:border-neutral-700"
          draggable={false}
        />
      ) : (
        <span className="text-sm text-slate-500 dark:text-neutral-400">Loading image…</span>
      )}
    </NodeViewWrapper>
  )
}

export const CourseAwareTipTapImage = Image.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CourseImageNodeView)
  },
})
