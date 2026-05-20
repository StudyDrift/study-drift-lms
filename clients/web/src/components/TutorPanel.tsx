import { useCallback, useEffect, useRef, useState } from 'react'
import { Bot, Send, Trash2, X } from 'lucide-react'
import { authorizedFetch } from '../lib/api'

const API_BASE = '/api/v1'

interface TutorMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ConversationState {
  conversationId: string
  messages: TutorMessage[]
  tokensUsed: number
  tokenLimit: number
  periodMonth: string
}

interface TutorPanelProps {
  courseCode: string
}

async function fetchConversation(courseCode: string): Promise<ConversationState> {
  const res = await authorizedFetch(
    `${API_BASE}/courses/${encodeURIComponent(courseCode)}/tutor/conversation`,
  )
  if (!res.ok) throw new Error(`Failed to load conversation: ${res.status}`)
  return res.json() as Promise<ConversationState>
}

async function resetConversation(courseCode: string): Promise<void> {
  const res = await authorizedFetch(
    `${API_BASE}/courses/${encodeURIComponent(courseCode)}/tutor/conversation`,
    { method: 'DELETE' },
  )
  if (!res.ok) throw new Error(`Failed to reset conversation: ${res.status}`)
}

export function TutorPanel({ courseCode }: TutorPanelProps) {
  const [open, setOpen] = useState(false)
  const [conv, setConv] = useState<ConversationState | null>(null)
  const [loading, setLoading] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [input, setInput] = useState('')
  const [streamedText, setStreamedText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    if (open && !conv) {
      setLoading(true)
      fetchConversation(courseCode)
        .then(setConv)
        .catch((e: unknown) => {
          setError(e instanceof Error ? e.message : 'Failed to load conversation.')
        })
        .finally(() => setLoading(false))
    }
  }, [open, conv, courseCode])

  useEffect(() => {
    scrollToBottom()
  }, [conv?.messages, streamedText, scrollToBottom])

  const sendMessage = useCallback(async () => {
    const text = input.trim()
    if (!text || streaming) return
    setInput('')
    setError(null)
    setStreaming(true)
    setStreamedText('')

    // Optimistically add the user message.
    setConv((prev) =>
      prev
        ? { ...prev, messages: [...prev.messages, { role: 'user', content: text }] }
        : prev,
    )

    try {
      const res = await authorizedFetch(
        `${API_BASE}/courses/${encodeURIComponent(courseCode)}/tutor/message`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text }),
        },
      )

      if (!res.ok || !res.body) {
        const body = await res.text()
        setError(body || `Error ${res.status}`)
        setStreaming(false)
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let fullText = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const payload = line.slice('data: '.length)
          try {
            const ev = JSON.parse(payload) as {
              type: string
              text?: string
              message?: string
              conversationId?: string
            }
            if (ev.type === 'content' && ev.text) {
              fullText += ev.text
              setStreamedText(fullText)
            } else if (ev.type === 'error') {
              setError(ev.message ?? 'An error occurred.')
            } else if (ev.type === 'done') {
              setConv((prev) =>
                prev
                  ? {
                      ...prev,
                      messages: [
                        ...prev.messages,
                        { role: 'assistant', content: fullText },
                      ],
                    }
                  : prev,
              )
              setStreamedText('')
            }
          } catch {
            // skip malformed lines
          }
        }
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to send message.')
    } finally {
      setStreaming(false)
    }
  }, [courseCode, input, streaming])

  const handleReset = useCallback(async () => {
    try {
      await resetConversation(courseCode)
      setConv((prev) => (prev ? { ...prev, messages: [] } : prev))
      setStreamedText('')
      setError(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to reset.')
    }
  }, [courseCode])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        void sendMessage()
      }
    },
    [sendMessage],
  )

  const budgetPct = conv ? Math.min(100, (conv.tokensUsed / conv.tokenLimit) * 100) : 0
  const budgetWarning = budgetPct >= 80

  return (
    <>
      {/* Floating button */}
      <button
        type="button"
        aria-label="Open AI Tutor"
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-24 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
      >
        <Bot className="h-7 w-7" />
      </button>

      {/* Slide-out side panel */}
      {open && (
        <div
          role="dialog"
          aria-label="AI Tutor"
          aria-modal="true"
          className="fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-white shadow-2xl dark:bg-neutral-900 sm:w-96"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-neutral-800">
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-indigo-600" />
              <span className="font-semibold text-slate-900 dark:text-neutral-100">AI Tutor</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Reset conversation"
                onClick={() => void handleReset()}
                className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
              >
                <Trash2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label="Close AI Tutor"
                onClick={() => setOpen(false)}
                className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Token budget bar */}
          {conv && (
            <div className="border-b border-slate-100 px-4 py-2 dark:border-neutral-800">
              <div className="mb-1 flex items-center justify-between text-xs text-slate-500 dark:text-neutral-400">
                <span>
                  {conv.tokensUsed.toLocaleString()} / {conv.tokenLimit.toLocaleString()} tokens used
                </span>
                <span>{conv.periodMonth}</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-neutral-800">
                <div
                  className={`h-full rounded-full transition-all ${budgetWarning ? 'bg-amber-500' : 'bg-indigo-500'}`}
                  style={{ width: `${budgetPct}%` }}
                />
              </div>
              {budgetWarning && (
                <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                  Approaching monthly AI token limit.
                </p>
              )}
            </div>
          )}

          {/* Message list */}
          <div
            role="log"
            aria-live="polite"
            aria-label="Tutor conversation"
            className="flex-1 overflow-y-auto px-4 py-4"
          >
            {loading && (
              <p className="text-sm text-slate-400 dark:text-neutral-500">Loading conversation…</p>
            )}
            {!loading && conv?.messages.length === 0 && !streamedText && (
              <p className="text-center text-sm text-slate-400 dark:text-neutral-500">
                Ask the AI tutor a question about this course.
              </p>
            )}
            {conv?.messages.map((msg, i) => (
              <div
                key={i}
                className={`mb-3 flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-100 text-slate-900 dark:bg-neutral-800 dark:text-neutral-100'
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            {streamedText && (
              <div className="mb-3 flex justify-start">
                <div className="max-w-[85%] rounded-2xl bg-slate-100 px-4 py-2.5 text-sm leading-relaxed text-slate-900 dark:bg-neutral-800 dark:text-neutral-100">
                  {streamedText}
                  <span className="ml-0.5 inline-block h-3 w-0.5 animate-pulse bg-current" />
                </div>
              </div>
            )}
            {error && (
              <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300">
                {error}
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input area */}
          <div className="border-t border-slate-200 px-4 py-3 dark:border-neutral-800">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                aria-label="Type your message"
                placeholder="Ask the tutor…"
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={streaming}
                className="flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder-neutral-500"
              />
              <button
                type="button"
                aria-label="Send message"
                onClick={() => void sendMessage()}
                disabled={!input.trim() || streaming}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1.5 text-center text-xs text-slate-400 dark:text-neutral-500">
              AI Tutor may make mistakes. Verify important information.
            </p>
          </div>
        </div>
      )}
    </>
  )
}
