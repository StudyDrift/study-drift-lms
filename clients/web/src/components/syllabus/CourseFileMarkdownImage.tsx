import type { CSSProperties } from 'react'
import { useEffect, useState } from 'react'
import { authorizedFetch } from '../../lib/api'
import { needsAuthenticatedCourseImageSrc, resolveAuthorizedFetchPath } from '../../lib/courseFileImage'

type CourseFileMarkdownImageProps = {
  src?: string | null
  alt?: string | null
  className?: string
  style?: CSSProperties
}

/** Renders Markdown images; fetches course file URLs with the session bearer token. */
export function CourseFileMarkdownImage({ src, alt, className, style }: CourseFileMarkdownImageProps) {
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

  if (!src) return null
  if (!url) {
    return (
      <span className="text-sm text-slate-500 dark:text-neutral-400" style={style}>
        Loading image…
      </span>
    )
  }
  return <img src={url} alt={alt ?? ''} className={className} style={style} loading="lazy" />
}
