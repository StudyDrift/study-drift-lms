import { useCallback, useEffect, useRef, useState } from 'react'
import { authorizedFetch } from '../../lib/api'
import type { SubmissionFeedbackMediaApi } from '../../lib/courses-api'
import { deleteSubmissionFeedbackMedia, getSubmissionFeedbackPlaybackInfo } from '../../lib/courses-api'

function FeedbackMediaItem({
  courseCode,
  itemId,
  submissionId,
  media,
  readOnly,
  onDeleted,
}: {
  courseCode: string
  itemId: string
  submissionId: string
  media: SubmissionFeedbackMediaApi
  readOnly: boolean
  onDeleted?: () => void
}) {
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  const [trackUrl, setTrackUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const revoke = useCallback(() => {
    if (mediaUrl) URL.revokeObjectURL(mediaUrl)
    if (trackUrl) URL.revokeObjectURL(trackUrl)
  }, [mediaUrl, trackUrl])

  useEffect(() => {
    let cancelled = false
    setError(null)
    setMediaUrl(null)
    setTrackUrl(null)
    void (async () => {
      try {
        const info = await getSubmissionFeedbackPlaybackInfo(courseCode, itemId, submissionId, media.id)
        const mRes = await authorizedFetch(info.contentPath)
        if (!mRes.ok) throw new Error('Could not load media.')
        const mBlob = await mRes.blob()
        if (cancelled) return
        setMediaUrl(URL.createObjectURL(mBlob))
        if (info.captionPath) {
          const tRes = await authorizedFetch(info.captionPath)
          if (tRes.ok) {
            const tBlob = await tRes.blob()
            if (!cancelled) setTrackUrl(URL.createObjectURL(tBlob))
          }
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Playback failed.')
      }
    })()
    return () => {
      cancelled = true
      revoke()
    }
  }, [courseCode, itemId, submissionId, media.id, revoke])

  useEffect(() => {
    return () => revoke()
  }, [revoke])

  const onKeyDown = (e: React.KeyboardEvent) => {
    const a = videoRef.current ?? audioRef.current
    if (!a) return
    if (e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault()
      if (a.paused) void a.play()
      else a.pause()
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      a.currentTime = Math.max(0, a.currentTime - 5)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      a.currentTime = Math.min(a.duration || 0, a.currentTime + 5)
    } else if (e.key === 'm' || e.key === 'M') {
      e.preventDefault()
      a.muted = !a.muted
    }
  }

  async function onDelete() {
    if (!window.confirm('Delete this media feedback?')) return
    try {
      await deleteSubmissionFeedbackMedia(courseCode, itemId, submissionId, media.id)
      onDeleted?.()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Could not delete.')
    }
  }

  if (error) {
    return (
      <p className="text-sm text-rose-700 dark:text-rose-200" role="alert">
        {error}
      </p>
    )
  }

  if (!mediaUrl) {
    return <p className="text-sm text-slate-500 dark:text-neutral-400">Loading…</p>
  }

  const cap =
    media.captionStatus === 'done' ? (
      <span className="ml-2 text-xs text-slate-500 dark:text-neutral-400">(captions)</span>
    ) : media.captionStatus === 'failed' ? (
      <span className="ml-2 text-xs text-amber-700 dark:text-amber-200">(captions unavailable)</span>
    ) : (
      <span className="ml-2 text-xs text-slate-500 dark:text-neutral-400">(captions generating…)</span>
    )

  return (
    <div
      className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 dark:border-neutral-600 dark:bg-neutral-900/60"
      onKeyDown={onKeyDown}
      tabIndex={0}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-medium text-slate-800 dark:text-neutral-100">
          Instructor feedback
          {media.durationSecs != null ? ` · ${media.durationSecs}s` : null}
          {cap}
        </div>
        {!readOnly && onDeleted ? (
          <button
            type="button"
            className="text-xs font-semibold text-rose-700 hover:underline dark:text-rose-300"
            onClick={() => void onDelete()}
          >
            Remove
          </button>
        ) : null}
      </div>
      {media.mediaType === 'video' ? (
        <video
          ref={videoRef}
          className="max-h-72 w-full rounded-lg bg-black"
          controls
          src={mediaUrl}
        >
          {trackUrl ? <track kind="captions" srcLang="en" label="Captions" default src={trackUrl} /> : null}
        </video>
      ) : (
        <audio ref={audioRef} className="w-full" controls src={mediaUrl}>
          {trackUrl ? <track kind="captions" srcLang="en" label="Captions" default src={trackUrl} /> : null}
        </audio>
      )}
      <p className="mt-1 text-xs text-slate-500 dark:text-neutral-500">
        Keyboard: Space play/pause · ←/→ seek · M mute
      </p>
    </div>
  )
}

export type FeedbackMediaPlayerListProps = {
  courseCode: string
  itemId: string
  submissionId: string
  items: SubmissionFeedbackMediaApi[]
  readOnly: boolean
  onChanged?: () => void
}

/** Inline A/V + captions for one submission’s feedback list (plan 3.2). */
export function FeedbackMediaPlayerList({ courseCode, itemId, submissionId, items, readOnly, onChanged }: FeedbackMediaPlayerListProps) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-slate-600 dark:text-neutral-400">
        {readOnly ? 'No media feedback yet.' : 'No media feedback saved yet.'}
      </p>
    )
  }
  return (
    <ul className="space-y-4" aria-label="Media feedback list">
      {items.map((m) => (
        <li key={m.id}>
          <FeedbackMediaItem
            courseCode={courseCode}
            itemId={itemId}
            submissionId={submissionId}
            media={m}
            readOnly={readOnly}
            onDeleted={onChanged}
          />
        </li>
      ))}
    </ul>
  )
}
