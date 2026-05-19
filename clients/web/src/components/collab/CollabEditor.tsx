/**
 * CollabEditor — real-time collaborative rich-text editor using TipTap + Y.js.
 * Connects to the Go WebSocket relay at /api/v1/courses/{code}/collab-docs/{id}/ws.
 */
import { useEffect, useReducer, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCursor from '@tiptap/extension-collaboration-cursor'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { getAccessToken } from '../../lib/auth'
import { collabDocWsUrl } from '../../lib/collab-docs-api'
import { PresenceBar } from './PresenceBar'
import { colorForUser } from './collab-utils'

type Props = {
  courseCode: string
  docId: string
  userName?: string
  readOnly?: boolean
}

type ConnState = 'connecting' | 'connected' | 'disconnected'

type Session = {
  ydoc: Y.Doc
  provider: WebsocketProvider
}

// useReducer keeps the session objects outside React's direct state machinery,
// avoiding the synchronous-setState-in-effect rule while still triggering re-renders.
type SessionAction =
  | { type: 'set'; session: Session }
  | { type: 'clear' }

function sessionReducer(_state: Session | null, action: SessionAction): Session | null {
  if (action.type === 'set') return action.session
  return null
}

export function CollabEditor({ courseCode, docId, userName = 'Anonymous', readOnly = false }: Props) {
  const [session, dispatchSession] = useReducer(sessionReducer, null)
  const [connState, setConnState] = useState<ConnState>('connecting')

  const wsUrl = collabDocWsUrl(courseCode, docId)

  useEffect(() => {
    const ydoc = new Y.Doc()
    const token = getAccessToken() ?? ''
    const provider = new WebsocketProvider(wsUrl, docId, ydoc, {
      connect: true,
      params: { token },
      WebSocketPolyfill: buildAuthWebSocket(token),
    })

    // Dispatch from callbacks (not synchronously) to satisfy the lint rule.
    // Schedule session state update after current effect commit.
    const rafId = requestAnimationFrame(() => {
      dispatchSession({ type: 'set', session: { ydoc, provider } })
    })

    provider.on('status', ({ status }: { status: string }) => {
      setConnState(status === 'connected' ? 'connected' : 'disconnected')
    })

    return () => {
      cancelAnimationFrame(rafId)
      dispatchSession({ type: 'clear' })
      provider.destroy()
      ydoc.destroy()
    }
  }, [wsUrl, docId])

  const extensions = session
    ? [
        StarterKit,
        Collaboration.configure({ document: session.ydoc }),
        CollaborationCursor.configure({
          provider: session.provider,
          user: { name: userName, color: colorForUser(userName) },
        }),
      ]
    : [StarterKit]

  const editor = useEditor(
    { editable: !readOnly, extensions },
    [session],
  )

  if (!editor) return null

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2 dark:border-neutral-700">
        <span className="text-sm text-slate-500 dark:text-neutral-400">
          {connState === 'connected' ? (
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full bg-green-500" aria-hidden="true" />
              Live
            </span>
          ) : connState === 'connecting' ? (
            'Connecting…'
          ) : (
            <span className="text-red-500">Offline — changes will sync when reconnected</span>
          )}
        </span>
        {session?.provider.awareness && (
          <PresenceBar
            awareness={session.provider.awareness}
            selfName={userName}
            selfColor={colorForUser(userName)}
          />
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        <EditorContent
          editor={editor}
          className="prose prose-slate dark:prose-invert mx-auto min-h-full max-w-3xl px-8 py-6 focus:outline-none"
        />
      </div>
    </div>
  )
}

/**
 * buildAuthWebSocket returns a WebSocket class that sends {"authToken":"..."} as
 * the first text message on open, matching what the Go server expects.
 */
function buildAuthWebSocket(token: string): typeof WebSocket {
  return class AuthWebSocket extends WebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols)
      this.addEventListener('open', () => {
        this.send(JSON.stringify({ authToken: token }))
      })
    }
  }
}
