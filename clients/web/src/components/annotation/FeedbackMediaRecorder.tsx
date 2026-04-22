import { useCallback, useEffect, useRef, useState } from 'react'
import { getAccessToken } from '../../lib/auth'
import {
  completeSubmissionFeedbackUpload,
  initiateSubmissionFeedbackUpload,
  putSubmissionFeedbackChunk,
  uploadSubmissionFeedbackMediaMultipart,
} from '../../lib/courses-api'

const MAX_SECS = 600
const CHUNK = 8 * 1024 * 1024

export type FeedbackMediaRecorderProps = {
  courseCode: string
  itemId: string
  submissionId: string
  onComplete: () => void
}

type Tab = 'record' | 'upload'

function pickMime(audioOnly: boolean): { mime: string; ext: string } {
  if (audioOnly) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
      return { mime: 'audio/webm;codecs=opus', ext: 'webm' }
    }
    return { mime: 'audio/webm', ext: 'webm' }
  }
  if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')) {
    return { mime: 'video/webm;codecs=vp8,opus', ext: 'webm' }
  }
  return { mime: 'video/webm', ext: 'webm' }
}

export function FeedbackMediaRecorder({ courseCode, itemId, submissionId, onComplete }: FeedbackMediaRecorderProps) {
  const [tab, setTab] = useState<Tab>('record')
  const [recordKind, setRecordKind] = useState<'audio' | 'video'>('audio')
  const [recording, setRecording] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(MAX_SECS)
  const [message, setMessage] = useState<string | null>(null)
  const [uploadPct, setUploadPct] = useState<number | null>(null)
  const mediaRecRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startedAtRef = useRef<number>(0)

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const cleanupStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  useEffect(
    () => () => {
      stopTimer()
      cleanupStream()
      mediaRecRef.current?.stop()
    },
    [cleanupStream, stopTimer],
  )

  const startRecording = useCallback(async () => {
    setMessage(null)
    const audioOnly = recordKind === 'audio'
    const { mime, ext } = pickMime(audioOnly)
    const constraints: MediaStreamConstraints = audioOnly
      ? { audio: true }
      : { audio: true, video: { facingMode: 'user' } }
    const stream = await navigator.mediaDevices.getUserMedia(constraints)
    streamRef.current = stream
    chunksRef.current = []
    const rec = new MediaRecorder(stream, { mimeType: mime })
    mediaRecRef.current = rec
    rec.ondataavailable = (ev) => {
      if (ev.data.size) chunksRef.current.push(ev.data)
    }
    rec.onerror = () => setMessage('Recording error.')
    rec.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mime })
      chunksRef.current = []
      cleanupStream()
      const duration = Math.min(MAX_SECS, Math.round((performance.now() - startedAtRef.current) / 1000))
      void (async () => {
        setMessage('Uploading…')
        try {
          await uploadSubmissionFeedbackMediaMultipart(
            courseCode,
            itemId,
            submissionId,
            blob,
            `feedback.${ext}`,
            duration,
          )
          setMessage(null)
          onComplete()
        } catch (e) {
          setMessage(e instanceof Error ? e.message : 'Upload failed.')
        }
      })()
    }
    rec.start(250)
    setRecording(true)
    startedAtRef.current = performance.now()
    setSecondsLeft(MAX_SECS)
    stopTimer()
    const start = Date.now()
    timerRef.current = setInterval(() => {
      const elapsed = (Date.now() - start) / 1000
      const left = Math.max(0, Math.ceil(MAX_SECS - elapsed))
      setSecondsLeft(left)
      if (left <= 0) {
        stopTimer()
        setRecording(false)
        const r = mediaRecRef.current
        if (r && r.state !== 'inactive') r.stop()
      }
    }, 500)
  }, [cleanupStream, courseCode, itemId, onComplete, recordKind, stopTimer, submissionId])

  const onStopAndSave = useCallback(() => {
    stopTimer()
    setRecording(false)
    const r = mediaRecRef.current
    if (r && r.state !== 'inactive') r.stop()
  }, [stopTimer])

  async function onPickFile(file: File | null) {
    if (!file) return
    setMessage(null)
    setUploadPct(0)
    const token = getAccessToken()
    if (!token) {
      setMessage('Not signed in.')
      setUploadPct(null)
      return
    }
    const mime = file.type || (file.name.endsWith('.mp3') ? 'audio/mpeg' : 'application/octet-stream')
    const mediaType: 'audio' | 'video' = mime.startsWith('video/') ? 'video' : 'audio'
    try {
      if (file.size <= CHUNK) {
        await uploadSubmissionFeedbackMediaMultipart(
          courseCode,
          itemId,
          submissionId,
          file,
          file.name,
        )
        setUploadPct(null)
        onComplete()
        return
      }
      const { mediaId, uploadPath } = await initiateSubmissionFeedbackUpload(
        courseCode,
        itemId,
        submissionId,
        { byteSize: file.size, mimeType: mime, mediaType },
      )
      let offset = 0
      while (offset < file.size) {
        const end = Math.min(offset + CHUNK, file.size)
        const buf = await file.slice(offset, end).arrayBuffer()
        await putSubmissionFeedbackChunk(uploadPath, buf, offset, token)
        offset = end
        setUploadPct(Math.round((100 * offset) / file.size))
      }
      await completeSubmissionFeedbackUpload(courseCode, itemId, submissionId, mediaId)
      setUploadPct(null)
      onComplete()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Upload failed.')
      setUploadPct(null)
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-neutral-600 dark:bg-neutral-900/40">
      <div className="flex gap-2 border-b border-slate-200 pb-2 dark:border-neutral-600" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'record'}
          className={`rounded-md px-3 py-1.5 text-sm font-medium ${
            tab === 'record' ? 'bg-slate-200 dark:bg-neutral-700' : 'text-slate-600 hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-neutral-800'
          }`}
          onClick={() => setTab('record')}
        >
          Record
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'upload'}
          className={`rounded-md px-3 py-1.5 text-sm font-medium ${
            tab === 'upload' ? 'bg-slate-200 dark:bg-neutral-700' : 'text-slate-600 hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-neutral-800'
          }`}
          onClick={() => setTab('upload')}
        >
          Upload
        </button>
      </div>

      {tab === 'record' ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={`rounded-md px-2 py-1 text-xs font-semibold ${
                recordKind === 'audio' ? 'bg-indigo-100 text-indigo-900 dark:bg-indigo-900/50 dark:text-indigo-100' : 'border border-slate-300 dark:border-neutral-600'
              }`}
              onClick={() => setRecordKind('audio')}
            >
              Audio
            </button>
            <button
              type="button"
              className={`rounded-md px-2 py-1 text-xs font-semibold ${
                recordKind === 'video' ? 'bg-indigo-100 text-indigo-900 dark:bg-indigo-900/50 dark:text-indigo-100' : 'border border-slate-300 dark:border-neutral-600'
              }`}
              onClick={() => setRecordKind('video')}
            >
              Video
            </button>
          </div>
          <p className="text-xs text-slate-600 dark:text-neutral-400" role="timer" aria-live="polite">
            {recording
              ? `Time remaining: ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`
              : `Maximum duration ${MAX_SECS / 60} minutes.`}
          </p>
          <div className="flex flex-wrap gap-2">
            {!recording ? (
              <button
                type="button"
                className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
                onClick={() => void startRecording().catch((e) => setMessage(e instanceof Error ? e.message : 'Could not start.'))}
              >
                {recordKind === 'audio' ? 'Record voice' : 'Record video'}
              </button>
            ) : (
              <button
                type="button"
                className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-100"
                onClick={onStopAndSave}
              >
                Stop & save
              </button>
            )}
          </div>
        </div>
      ) : (
        <div>
          <label className="block text-sm text-slate-700 dark:text-neutral-200">
            <span className="mb-1 block">File (MP3, M4A, MP4, MOV, WEBM — up to 500 MB)</span>
            <input
              type="file"
              accept="audio/*,video/*,.mp3,.m4a,.mp4,.mov,.webm"
              className="text-sm"
              onChange={(e) => void onPickFile(e.target.files?.[0] ?? null)}
            />
          </label>
          {uploadPct != null ? (
            <p className="mt-2 text-sm text-slate-600 dark:text-neutral-400" aria-live="polite">
              Uploading… {uploadPct}%
            </p>
          ) : null}
        </div>
      )}

      {message ? (
        <p className="text-sm text-rose-800 dark:text-rose-200" role="status">
          {message}
        </p>
      ) : null}
    </div>
  )
}
