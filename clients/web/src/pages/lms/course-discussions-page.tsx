import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Lock, MessageCircle, Pin, Plus, ThumbsUp, Trash2 } from 'lucide-react'
import { DiscussionDocEditor, DiscussionReadonlyBody } from '../../components/discussions/discussion-doc-editor'
import { usePermissions } from '../../context/use-permissions'
import { getJwtSubject } from '../../lib/auth'
import { fetchCourse, courseItemCreatePermission, type CoursePublic } from '../../lib/courses-api'
import {
  createDiscussionForum,
  createDiscussionPost,
  createDiscussionThread,
  deleteDiscussionPost,
  emptyTipTapDoc,
  fetchDiscussionForums,
  fetchDiscussionPosts,
  fetchDiscussionThread,
  fetchDiscussionThreads,
  patchDiscussionThread,
  upvoteDiscussionPost,
  type DiscussionForum,
  type DiscussionPost,
  type DiscussionThreadDetail,
  type DiscussionThreadSummary,
} from '../../lib/discussions-api'
import { LmsPage } from './lms-page'

function nestPosts(posts: DiscussionPost[]): DiscussionPost[] {
  const byParent = new Map<string | null, DiscussionPost[]>()
  for (const p of posts) {
    const k = p.parentPostId ?? null
    const arr = byParent.get(k) ?? []
    arr.push(p)
    byParent.set(k, arr)
  }
  for (const arr of byParent.values()) {
    arr.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }
  const out: DiscussionPost[] = []
  const walk = (parent: string | null) => {
    const kids = byParent.get(parent) ?? []
    for (const c of kids) {
      out.push(c)
      walk(c.id)
    }
  }
  walk(null)
  return out
}

export default function CourseDiscussionsPage() {
  const { courseCode: rawCode } = useParams<{ courseCode: string }>()
  const courseCode = rawCode ? decodeURIComponent(rawCode) : ''
  const { allows, loading: permLoading } = usePermissions()
  const viewerId = getJwtSubject()
  const canModerate = !permLoading && !!courseCode && allows(courseItemCreatePermission(courseCode))

  const [course, setCourse] = useState<CoursePublic | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [forums, setForums] = useState<DiscussionForum[]>([])
  const [forumId, setForumId] = useState<string | null>(null)
  const [threads, setThreads] = useState<DiscussionThreadSummary[]>([])
  const [threadId, setThreadId] = useState<string | null>(null)
  const [threadDetail, setThreadDetail] = useState<DiscussionThreadDetail | null>(null)
  const [posts, setPosts] = useState<DiscussionPost[]>([])
  const [hiddenUntilFirstPost, setHiddenUntilFirstPost] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const [newForumName, setNewForumName] = useState('')
  const [showNewForum, setShowNewForum] = useState(false)
  const [replyParentId, setReplyParentId] = useState<string | null>(null)
  const [replyBody, setReplyBody] = useState<Record<string, unknown>>(
    emptyTipTapDoc as Record<string, unknown>,
  )

  const reloadForums = useCallback(async () => {
    if (!courseCode) return
    const list = await fetchDiscussionForums(courseCode)
    setForums(list)
  }, [courseCode])

  useEffect(() => {
    if (forumId || forums.length === 0) return
    setForumId(forums[0].id)
  }, [forums, forumId])

  useEffect(() => {
    if (!courseCode) return
    let cancelled = false
    void (async () => {
      setLoadErr(null)
      try {
        const c = await fetchCourse(courseCode)
        if (cancelled) return
        setCourse(c)
        if (c.discussionsEnabled !== true) {
          setLoadErr('Discussions are turned off for this course. Enable them under Course settings → Features.')
          return
        }
        await reloadForums()
      } catch (e) {
        if (!cancelled) setLoadErr(e instanceof Error ? e.message : 'Could not load discussions.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [courseCode, reloadForums])

  useEffect(() => {
    if (!courseCode || !forumId || course?.discussionsEnabled !== true) return
    let cancelled = false
    void (async () => {
      try {
        const t = await fetchDiscussionThreads(courseCode, forumId)
        if (!cancelled) setThreads(t)
      } catch {
        if (!cancelled) setThreads([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [courseCode, forumId, course?.discussionsEnabled])

  const loadThread = useCallback(
    async (tid: string) => {
      if (!courseCode) return
      setBusy(true)
      setMsg(null)
      try {
        const [detail, pr] = await Promise.all([
          fetchDiscussionThread(courseCode, tid),
          fetchDiscussionPosts(courseCode, tid),
        ])
        setThreadDetail(detail)
        setPosts(pr.posts)
        setHiddenUntilFirstPost(pr.hiddenUntilFirstPost)
        setThreadId(tid)
        setReplyParentId(null)
        setReplyBody(emptyTipTapDoc as Record<string, unknown>)
      } catch (e) {
        setMsg(e instanceof Error ? e.message : 'Could not load thread.')
      } finally {
        setBusy(false)
      }
    },
    [courseCode],
  )

  const orderedPosts = useMemo(() => nestPosts(posts), [posts])

  const depthOf = useCallback(
    (id: string): number => {
      const byId = new Map(posts.map((p) => [p.id, p]))
      let d = 0
      let cur: DiscussionPost | undefined = byId.get(id)
      while (cur?.parentPostId) {
        d++
        cur = byId.get(cur.parentPostId)
      }
      return d
    },
    [posts],
  )

  if (!courseCode) {
    return (
      <LmsPage title="Discussions" description="">
        <p className="mt-6 text-sm text-slate-500">Invalid course.</p>
      </LmsPage>
    )
  }

  return (
    <LmsPage
      title="Discussions"
      description="Threaded forums for async class conversations."
      fillHeight
      omitHeader
    >
      <div
        className="flex min-h-0 flex-1 flex-col gap-4 md:flex-row"
        data-discussions-root
      >
        <aside className="flex w-full shrink-0 flex-col gap-2 border-b border-slate-200 pb-4 md:w-56 md:border-b-0 md:border-r md:pb-0 md:pr-4 dark:border-neutral-700">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-neutral-100">Forums</h2>
            {canModerate ? (
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-800"
                onClick={() => setShowNewForum((v) => !v)}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                New
              </button>
            ) : null}
          </div>
          {showNewForum && canModerate ? (
            <form
              className="flex flex-col gap-2 rounded-lg border border-slate-200 p-2 dark:border-neutral-700"
              onSubmit={async (ev) => {
                ev.preventDefault()
                if (!newForumName.trim()) return
                setBusy(true)
                try {
                  await createDiscussionForum(courseCode, { name: newForumName.trim() })
                  setNewForumName('')
                  setShowNewForum(false)
                  await reloadForums()
                } catch (e) {
                  setMsg(e instanceof Error ? e.message : 'Could not create forum.')
                } finally {
                  setBusy(false)
                }
              }}
            >
              <label className="sr-only" htmlFor="new-forum-name">
                Forum name
              </label>
              <input
                id="new-forum-name"
                className="rounded border border-slate-200 px-2 py-1 text-sm dark:border-neutral-600 dark:bg-neutral-900"
                value={newForumName}
                onChange={(e) => setNewForumName(e.target.value)}
                placeholder="Forum name"
              />
              <button
                type="submit"
                disabled={busy}
                className="rounded bg-indigo-600 px-2 py-1 text-xs font-semibold text-white disabled:opacity-50"
              >
                Create
              </button>
            </form>
          ) : null}
          <nav className="flex flex-col gap-1" aria-label="Discussion forums">
            {forums.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => {
                  setForumId(f.id)
                  setThreadId(null)
                  setThreadDetail(null)
                  setPosts([])
                }}
                className={`rounded-lg px-2 py-1.5 text-left text-sm ${
                  forumId === f.id
                    ? 'bg-indigo-50 font-medium text-indigo-900 dark:bg-indigo-950/50 dark:text-indigo-100'
                    : 'text-slate-700 hover:bg-slate-50 dark:text-neutral-200 dark:hover:bg-neutral-800'
                }`}
              >
                {f.name}
              </button>
            ))}
          </nav>
          {forums.length === 0 && !loadErr ? (
            <p className="text-xs text-slate-500 dark:text-neutral-400">No forums yet.</p>
          ) : null}
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
          {loadErr ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-50">
              {loadErr}{' '}
              <Link
                to={`/courses/${encodeURIComponent(courseCode)}/settings/features`}
                className="font-semibold underline"
              >
                Open Features
              </Link>
            </p>
          ) : null}
          {msg ? (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-50">
              {msg}
            </p>
          ) : null}

          {!threadId ? (
            <section aria-label="Threads" className="flex min-h-0 flex-1 flex-col">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold text-slate-900 dark:text-neutral-50">Threads</h2>
                <button
                  type="button"
                  disabled={!forumId || busy}
                  className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                  onClick={() => {
                    const title = window.prompt('Thread title')
                    if (!title?.trim() || !forumId) return
                    void (async () => {
                      setBusy(true)
                      try {
                        const t = await createDiscussionThread(courseCode, forumId, {
                          title: title.trim(),
                          body: emptyTipTapDoc,
                        })
                        await loadThread(t.id)
                        const list = await fetchDiscussionThreads(courseCode, forumId)
                        setThreads(list)
                      } catch (e) {
                        setMsg(e instanceof Error ? e.message : 'Could not create thread.')
                      } finally {
                        setBusy(false)
                      }
                    })()
                  }}
                >
                  <Plus className="h-4 w-4" aria-hidden />
                  New thread
                </button>
              </div>
              <ul className="space-y-2 overflow-y-auto">
                {threads.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      className="flex w-full items-start gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm shadow-sm hover:border-indigo-200 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:border-indigo-800"
                      onClick={() => void loadThread(t.id)}
                    >
                      {t.isPinned ? (
                        <Pin className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-label="Pinned" />
                      ) : (
                        <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="font-medium text-slate-900 dark:text-neutral-50">{t.title}</span>
                        <span className="mt-0.5 block text-xs text-slate-500 dark:text-neutral-400">
                          {t.replyCount} repl{t.replyCount === 1 ? 'y' : 'ies'}
                          {t.isLocked ? ' · Closed' : ''}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {threads.length === 0 && forumId ? (
                <p className="text-sm text-slate-500 dark:text-neutral-400">No threads in this forum yet.</p>
              ) : null}
            </section>
          ) : (
            <section className="flex min-h-0 flex-1 flex-col gap-4" aria-label="Thread">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-300"
                  onClick={() => {
                    setThreadId(null)
                    setThreadDetail(null)
                    setPosts([])
                  }}
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden />
                  Threads
                </button>
                {threadDetail?.isPinned ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900 dark:bg-amber-950 dark:text-amber-100">
                    Pinned
                  </span>
                ) : null}
                {threadDetail?.isLocked ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-800 dark:bg-neutral-800 dark:text-neutral-100">
                    <Lock className="h-3 w-3" aria-hidden />
                    Closed
                  </span>
                ) : null}
              </div>
              {threadDetail ? (
                <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
                  <h1 className="text-xl font-semibold text-slate-900 dark:text-neutral-50">
                    {threadDetail.title}
                  </h1>
                  <div className="mt-3 text-sm">
                    <DiscussionReadonlyBody docJson={threadDetail.body} />
                  </div>
                  {canModerate ? (
                    <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3 dark:border-neutral-800">
                      <button
                        type="button"
                        className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium dark:border-neutral-600"
                        onClick={async () => {
                          if (!threadDetail) return
                          setBusy(true)
                          try {
                            const u = await patchDiscussionThread(courseCode, threadDetail.id, {
                              isPinned: !threadDetail.isPinned,
                            })
                            setThreadDetail(u)
                          } catch (e) {
                            setMsg(e instanceof Error ? e.message : 'Could not update thread.')
                          } finally {
                            setBusy(false)
                          }
                        }}
                      >
                        {threadDetail.isPinned ? 'Unpin' : 'Pin'}
                      </button>
                      <button
                        type="button"
                        className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium dark:border-neutral-600"
                        onClick={async () => {
                          if (!threadDetail) return
                          setBusy(true)
                          try {
                            const u = await patchDiscussionThread(courseCode, threadDetail.id, {
                              isLocked: !threadDetail.isLocked,
                            })
                            setThreadDetail(u)
                          } catch (e) {
                            setMsg(e instanceof Error ? e.message : 'Could not update thread.')
                          } finally {
                            setBusy(false)
                          }
                        }}
                      >
                        {threadDetail.isLocked ? 'Unlock' : 'Lock'}
                      </button>
                    </div>
                  ) : null}
                </article>
              ) : null}

              {hiddenUntilFirstPost ? (
                <p
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
                  role="status"
                >
                  Other replies are hidden until you post your first response below.
                </p>
              ) : null}

              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
                {orderedPosts.map((p) => {
                  const d = depthOf(p.id)
                  const indent = Math.min(d, 2)
                  const displayIndent = Math.min(indent, 2)
                  const marginClass =
                    displayIndent === 0
                      ? ''
                      : displayIndent === 1
                        ? 'ml-3 md:ml-6'
                        : 'ml-3 md:ml-12'
                  return (
                    <article
                      key={p.id}
                      role="article"
                      aria-level={displayIndent + 2}
                      className={`rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-neutral-700 dark:bg-neutral-900 ${marginClass}`}
                    >
                      <div className="text-sm">
                        <DiscussionReadonlyBody docJson={p.body} />
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-2 text-xs dark:border-neutral-800">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-800"
                          aria-label={`Upvote (${p.upvoteCount} votes)`}
                          disabled={busy || threadDetail?.isLocked}
                          onClick={async () => {
                            if (!threadDetail) return
                            setBusy(true)
                            try {
                              const r = await upvoteDiscussionPost(courseCode, p.id)
                              setPosts((prev) =>
                                prev.map((x) =>
                                  x.id === p.id ? { ...x, upvoteCount: r.upvoteCount, viewerUpvoted: true } : x,
                                ),
                              )
                            } catch (e) {
                              const raw = e instanceof Error ? e.message : ''
                              if (!raw.toLowerCase().includes('conflict')) {
                                setMsg(raw || 'Could not upvote.')
                              }
                            } finally {
                              setBusy(false)
                            }
                          }}
                        >
                          <ThumbsUp className="h-3.5 w-3.5" aria-hidden />
                          {p.upvoteCount}
                        </button>
                        <button
                          type="button"
                          className="text-indigo-600 hover:underline dark:text-indigo-300"
                          disabled={!!threadDetail?.isLocked}
                          onClick={() => {
                            setReplyParentId(p.id)
                            setReplyBody(emptyTipTapDoc as Record<string, unknown>)
                          }}
                        >
                          Reply
                        </button>
                        {(viewerId && p.authorId === viewerId) || canModerate ? (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 text-rose-600 hover:underline dark:text-rose-400"
                            onClick={async () => {
                              if (!window.confirm('Delete this post and its replies?')) return
                              setBusy(true)
                              try {
                                await deleteDiscussionPost(courseCode, p.id)
                                if (threadDetail) await loadThread(threadDetail.id)
                              } catch (e) {
                                setMsg(e instanceof Error ? e.message : 'Could not delete.')
                              } finally {
                                setBusy(false)
                              }
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden />
                            Delete
                          </button>
                        ) : null}
                      </div>
                    </article>
                  )
                })}
              </div>

              {threadDetail?.isLocked ? (
                <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200">
                  This discussion has been closed by the instructor.
                </p>
              ) : (
                <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-neutral-700 dark:bg-neutral-900">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-neutral-400">
                    {replyParentId ? 'Your reply' : 'Your reply'}
                  </p>
                  <DiscussionDocEditor
                    value={replyBody}
                    onChange={setReplyBody}
                    disabled={busy}
                    placeholder="Write your reply…"
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    {replyParentId ? (
                      <button
                        type="button"
                        className="text-xs text-slate-600 underline dark:text-neutral-300"
                        onClick={() => setReplyParentId(null)}
                      >
                        Post at top level instead
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={busy}
                      className="ml-auto rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                      onClick={async () => {
                        if (!threadDetail) return
                        setBusy(true)
                        setMsg(null)
                        try {
                          await createDiscussionPost(courseCode, threadDetail.id, {
                            parentPostId: replyParentId,
                            body: replyBody,
                            idempotencyKey: crypto.randomUUID(),
                          })
                          setReplyBody(emptyTipTapDoc as Record<string, unknown>)
                          setReplyParentId(null)
                          await loadThread(threadDetail.id)
                          if (forumId) {
                            const list = await fetchDiscussionThreads(courseCode, forumId)
                            setThreads(list)
                          }
                        } catch (e) {
                          setMsg(e instanceof Error ? e.message : 'Could not post.')
                        } finally {
                          setBusy(false)
                        }
                      }}
                    >
                      Post
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </LmsPage>
  )
}
